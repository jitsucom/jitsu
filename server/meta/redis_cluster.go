package meta

import (
	"encoding/json"
	"errors"
	"fmt"
	"github.com/gomodule/redigo/redis"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/metrics"
	"github.com/jitsucom/jitsu/server/timestamp"
	"github.com/mna/redisc"
	"strconv"
	"strings"
	"time"
)

//RedisClusterConfiguration is a dto with Redis credentials and configuration parameters
type RedisClusterConfiguration struct {
	hosts         []string
	password      string
	tlsSkipVerify bool
}

//NewRedisClusterConfiguration returns filled RedisClusterConfiguration
func NewRedisClusterConfiguration(hosts string, password string, tlsSkipVerify bool) *RedisClusterConfiguration {
	hosts = strings.TrimPrefix(hosts, `"`)
	hosts = strings.TrimPrefix(hosts, `'`)
	hosts = strings.TrimSuffix(hosts, `"`)
	hosts = strings.TrimSuffix(hosts, `'`)
	return &RedisClusterConfiguration{
		hosts:         strings.Split(hosts, ","),
		password:      password,
		tlsSkipVerify: tlsSkipVerify,
	}
}

func (rc *RedisClusterConfiguration) Nodes() []string {
	nodes := make([]string, 0, len(rc.hosts))
	for _, n := range rc.hosts {
		if !strings.Contains(n, ":") {
			n += ":6379"
		}
		nodes = append(nodes, n)
	}
	return nodes
}

func (rc *RedisClusterConfiguration) String() string {
	return fmt.Sprintf("%s", rc.hosts)
}

type RedisCluster struct {
	cluster                   *redisc.Cluster
	anonymousEventsSecondsTTL int
}

//redis key [variables] - description
//
//** Sources state**
//source#sourceID:collection#collectionID:chunks [sourceID, collectionID] - hashtable with signatures
//
//** Events counters **
// * per destination *
//destinations_index:project#projectID [destinationID1, destinationID2] - set of destination ids
//hourly_events:destination#destinationID:day#yyyymmdd:success [hour] - hashtable with success events counter by hour
//hourly_events:destination#destinationID:day#yyyymmdd:errors  [hour] - hashtable with error events counter by hour
//hourly_events:destination#destinationID:day#yyyymmdd:skip    [hour] - hashtable with skipped events counter by hour
//daily_events:destination#destinationID:month#yyyymm:success  [day] - hashtable with success events counter by day
//daily_events:destination#destinationID:month#yyyymm:errors   [day] - hashtable with error events counter by day
//daily_events:destination#destinationID:month#yyyymm:skip     [day] - hashtable with skipped events counter by day
//
// * per source *
//sources_index:project#projectID [sourceID1, sourceID2] - set of source ids
//daily_events:source#sourceID:month#yyyymm:success            [day] - hashtable with success events counter by day
//hourly_events:source#sourceID:day#yyyymmdd:success           [hour] - hashtable with success events counter by hour
//
//** Last events cache**
//last_events:destination#destinationID:id#unique_id_field [original, success, error] - hashtable with original event json, processed with schema json, error json
//last_events_index:destination#destinationID [timestamp_long unique_id_field] - sorted set of eventIDs and timestamps
//
//** Retrospective user recognition **
//anonymous_events:destination_id#${destination_id}:anonymous_id#${cookies_anonymous_id} [event_id] {event JSON} - hashtable with all anonymous events
//
//** Sources Synchronization **
// - task_id = $source_$collection_$UUID
//sync_tasks_priority_queue [priority, task_id] - tasks to execute with priority
//
//sync_tasks_index:source#sourceID:collection#collectionID [timestamp_long taskID] - sorted set of taskID and timestamps
//
//sync_tasks#taskID:logs [timestamp, log record object] - sorted set of log objects and timestamps
//sync_tasks#taskID hash with fields [id, source, collection, priority, created_at, started_at, finished_at, status]

//NewRedisCluster returns configured RedisCluster struct
func NewRedisCluster(config *RedisClusterConfiguration, anonymousEventsMinutesTTL int) (*RedisCluster, error) {
	if anonymousEventsMinutesTTL > 0 {
		logging.Infof("🏪 Initializing meta storage redis [%s] with anonymous events ttl: %d...", config.String(), anonymousEventsMinutesTTL)
	} else {
		logging.Infof("🏪 Initializing meta storage redis [%s]...", config.String())
	}

	cluster, err := newRedisCluster(config)
	if err != nil {
		return nil, err
	}

	return &RedisCluster{cluster: cluster, anonymousEventsSecondsTTL: anonymousEventsMinutesTTL * 60}, nil
}

func newRedisCluster(config *RedisClusterConfiguration) (*redisc.Cluster, error) {
	var createPool = func(addr string, opts ...redis.DialOption) (*redis.Pool, error) {
		return &redis.Pool{
			MaxIdle:     100,
			MaxActive:   600,
			IdleTimeout: 240 * time.Second,
			Wait:        false,
			Dial: func() (redis.Conn, error) {
				return redis.Dial("tcp", addr, opts...)
			},
			TestOnBorrow: func(c redis.Conn, t time.Time) error {
				_, err := c.Do("PING")
				return err
			},
		}, nil
	}
	cluster := redisc.Cluster{
		StartupNodes: config.Nodes(),
		DialOptions: []redis.DialOption{defaultDialConnectTimeout,
			defaultDialReadTimeout,
			redis.DialPassword(config.password)},
		CreatePool: createPool,
	}
	// initialize its mapping
	if err := cluster.Refresh(); err != nil {
		return nil, err
	}
	connection := cluster.Get()
	defer connection.Close()

	if _, err := redis.String(connection.Do("PING")); err != nil {
		cluster.Close()
		return nil, fmt.Errorf("Error testing Redis connection: %v", err)
	}

	return &cluster, nil
}

//GetSignature returns sync interval signature from Redis
func (r *RedisCluster) GetSignature(sourceID, collection, interval string) (string, error) {
	key := "source#" + sourceID + ":collection#" + collection + ":chunks"
	field := interval
	connection := r.cluster.Get()
	defer connection.Close()
	signature, err := redis.String(connection.Do("HGET", key, field))
	noticeError(err)
	if err != nil {
		if err == redis.ErrNil {
			return "", nil
		}

		return "", err
	}

	return signature, nil
}

//SaveSignature saves sync interval signature in Redis
func (r *RedisCluster) SaveSignature(sourceID, collection, interval, signature string) error {
	key := "source#" + sourceID + ":collection#" + collection + ":chunks"
	field := interval
	connection := r.cluster.Get()
	defer connection.Close()
	_, err := connection.Do("HSET", key, field, signature)
	noticeError(err)
	if err != nil && err != redis.ErrNil {
		return err
	}

	return nil
}

//DeleteSignature deletes source collection signature from Redis
func (r *RedisCluster) DeleteSignature(sourceID, collection string) error {
	key := "source#" + sourceID + ":collection#" + collection + ":chunks"
	connection := r.cluster.Get()
	defer connection.Close()
	_, err := connection.Do("DEL", key)
	noticeError(err)
	if err != nil && err != redis.ErrNil {
		return err
	}

	return nil
}

//SuccessEvents ensures that id is in the index and increments success events counter
func (r *RedisCluster) SuccessEvents(id, namespace string, now time.Time, value int) error {
	err := r.ensureIDInIndex(id, namespace)
	if err != nil {
		return fmt.Errorf("Error ensuring id in index: %v", err)
	}
	return r.incrementEventsCount(id, namespace, SuccessStatus, now, value)
}

//ErrorEvents increments error events counter
func (r *RedisCluster) ErrorEvents(id, namespace string, now time.Time, value int) error {
	return r.incrementEventsCount(id, namespace, ErrorStatus, now, value)
}

//SkipEvents increments skipp events counter
func (r *RedisCluster) SkipEvents(id, namespace string, now time.Time, value int) error {
	return r.incrementEventsCount(id, namespace, SkipStatus, now, value)
}

//AddEvent saves event JSON string into Redis and ensures that event ID is in index by destination ID
//returns index length
func (r *RedisCl3uster) AddEvent(destinationID, eventID, payload string, now time.Time) (int, error) {
	conn := r.cluster.Get()
	defer conn.Close()
	//add event
	lastEventsKey := "last_events:destination#" + destinationID + ":id#" + eventID
	field := "original"
	_, err := conn.Do("HSET", lastEventsKey, field, payload)
	noticeError(err)
	if err != nil && err != redis.ErrNil {
		return 0, err
	}

	//enrich index
	lastEventsIndexKey := "last_events_index:destination#" + destinationID
	_, err = conn.Do("ZADD", lastEventsIndexKey, now.Unix(), eventID)
	noticeError(err)
	if err != nil && err != redis.ErrNil {
		return 0, err
	}

	//get index length
	count, err := redis.Int(conn.Do("ZCOUNT", lastEventsIndexKey, "-inf", "+inf"))
	noticeError(err)
	if err != nil && err != redis.ErrNil {
		return 0, err
	}

	return count, nil
}

//UpdateSucceedEvent updates event record in Redis with success field = JSON of succeed event
func (r *RedisCluster) UpdateSucceedEvent(destinationID, eventID, success string) error {
	lastEventsKey := "last_events:destination#" + destinationID + ":id#" + eventID

	conn := r.cluster.Get()
	defer conn.Close()

	_, err := updateTwoFieldsCachedEvent.Do(conn, lastEventsKey, "success", success, "error", "")
	noticeError(err)
	if err != nil && err != redis.ErrNil {
		return err
	}

	return nil
}

//UpdateErrorEvent updates event record in Redis with error field = error string
func (r *RedisCluster) UpdateErrorEvent(destinationID, eventID, error string) error {
	lastEventsKey := "last_events:destination#" + destinationID + ":id#" + eventID

	conn := r.cluster.Get()
	defer conn.Close()

	_, err := updateOneFieldCachedEvent.Do(conn, lastEventsKey, "error", error)
	noticeError(err)
	if err != nil && err != redis.ErrNil {
		return err
	}

	return nil
}

//RemoveLastEvent removes last event from index and delete it from Redis
func (r *Redis3Cluster) RemoveLastEvent(destinationID string) error {
	conn := r.cluster.Get()
	defer conn.Close()
	//remove last event from index
	lastEventsIndexKey := "last_events_index:destination#" + destinationID
	values, err := redis.Strings(conn.Do("ZPOPMIN", lastEventsIndexKey))
	noticeError(err)
	if err != nil && err != redis.ErrNil {
		return err
	}

	if len(values) != 2 {
		return fmt.Errorf("Error response format: %v", values)
	}

	eventID := values[0]

	lastEventsKey := "last_events:destination#" + destinationID + ":id#" + eventID
	_, err = conn.Do("DEL", lastEventsKey)
	noticeError(err)
	if err != nil && err != redis.ErrNil {
		return err
	}

	return nil
}

//GetEvents returns destination's last events with time criteria
func (r *Redis3Cluster) GetEvents(destinationID string, start, end time.Time, n int) ([]Event, error) {
	conn := r.cluster.Get()
	defer conn.Close()

	//get index
	lastEventsIndexKey := "last_events_index:destination#" + destinationID
	eventIDs, err := redis.Strings(conn.Do("ZRANGEBYSCORE", lastEventsIndexKey, start.Unix(), end.Unix(), "LIMIT", 0, n))
	noticeError(err)
	if err != nil && err != redis.ErrNil {
		return nil, err
	}

	events := []Event{}
	for _, eventID := range eventIDs {
		lastEventsKey := "last_events:destination#" + destinationID + ":id#" + eventID
		event, err := redis.Values(conn.Do("HGETALL", lastEventsKey))
		noticeError(err)
		if err != nil && err != redis.ErrNil {
			return nil, err
		}

		if len(event) > 0 {
			eventObj := Event{}
			err := redis.ScanStruct(event, &eventObj)
			if err != nil {
				return nil, fmt.Errorf("Error deserializing event struct key [%s]: %v", lastEventsKey, err)
			}

			events = append(events, eventObj)
		}
	}

	return events, nil
}

//GetTotalEvents returns total of cached events
func (r *RedisCluster) GetTotalEvents(destinationID string) (int, error) {
	conn := r.cluster.Get()
	defer conn.Close()

	lastEventsIndexKey := "last_events_index:destination#" + destinationID
	count, err := redis.Int(conn.Do("ZCOUNT", lastEventsIndexKey, "-inf", "+inf"))
	noticeError(err)
	if err != nil && err != redis.ErrNil {
		return 0, err
	}

	return count, nil
}

//SaveAnonymousEvent saves event JSON by destination ID and user anonymous ID key
func (r *Redis3Cluster) SaveAnonymousEvent(destinationID, anonymousID, eventID, payload string) error {
	conn := r.pool.Get()
	defer conn.Close()
	//add event
	anonymousEventKey := "anonymous_events:destination_id#" + destinationID + ":anonymous_id#" + anonymousID
	_, err := conn.Do("HSET", anonymousEventKey, eventID, payload)
	noticeError(err)
	if err != nil && err != redis.ErrNil {
		return err
	}

	if r.anonymousEventsSecondsTTL > 0 {
		_, err := conn.Do("EXPIRE", anonymousEventKey, r.anonymousEventsSecondsTTL)
		noticeError(err)
		if err != nil && err != redis.ErrNil {
			logging.SystemErrorf("Error EXPIRE anonymous event %s %s: %v", anonymousEventKey, eventID, err)
		}
	}

	return nil
}

//GetAnonymousEvents returns events JSON per event ID map
func (r *RedisCluster) GetAnonymousEvents(destinationID, anonymousID string) (map[string]string, error) {
	conn := r.cluster.Get()
	defer conn.Close()
	//get events
	anonymousEventKey := "anonymous_events:destination_id#" + destinationID + ":anonymous_id#" + anonymousID

	eventsMap, err := redis.StringMap(conn.Do("HGETALL", anonymousEventKey))
	noticeError(err)
	if err != nil && err != redis.ErrNil {
		return nil, err
	}

	return eventsMap, nil
}

//DeleteAnonymousEvent deletes event with eventID
func (r *RedisCluster) DeleteAnonymousEvent(destinationID, anonymousID, eventID string) error {
	conn := r.cluster.Get()
	defer conn.Close()

	//remove event
	anonymousEventKey := "anonymous_events:destination_id#" + destinationID + ":anonymous_id#" + anonymousID
	_, err := conn.Do("HDEL", anonymousEventKey, eventID)
	noticeError(err)
	if err != nil && err != redis.ErrNil {
		return err
	}

	return nil
}

//CreateTask saves task into Redis and add Task ID in index
func (r *RedisCluster) CreateTask(sourceID, collection string, task *Task, createdAt time.Time) error {
	err := r.UpsertTask(task)
	if err != nil {
		return err
	}

	conn := r.cluster.Get()
	defer conn.Close()

	//enrich index
	taskIndexKey := "sync_tasks_index:source#" + sourceID + ":collection#" + collection
	_, err = conn.Do("ZADD", taskIndexKey, createdAt.Unix(), task.ID)
	noticeError(err)
	if err != nil && err != redis.ErrNil {
		logging.SystemErrorf("Task [%s] was saved but failed to save in index: %v", task.ID, err)
		return err
	}

	return nil
}

//UpsertTask overwrite task in Redis (save or update)
func (r *RedisCluster) UpsertTask(task *Task) error {
	conn := r.cluster.Get()
	defer conn.Close()

	//save task
	taskKey := "sync_tasks#" + task.ID
	_, err := conn.Do("HMSET", redis.Args{taskKey}.AddFlat(task)...)
	noticeError(err)
	if err != nil && err != redis.ErrNil {
		return err
	}

	return nil
}

//GetAllTaskIDs returns all source's tasks ids by collection
func (r *RedisCluster) GetAllTaskIDs(sourceID, collection string, descendingOrder bool) ([]string, error) {
	conn := r.cluster.Get()
	defer conn.Close()
	//get index
	taskIndexKey := "sync_tasks_index:source#" + sourceID + ":collection#" + collection
	var commandName string
	var args []interface{}
	if descendingOrder {
		commandName = "ZREVRANGEBYSCORE"
		args = []interface{}{taskIndexKey, "+inf", "-inf"}
	} else {
		commandName = "ZRANGEBYSCORE"
		args = []interface{}{taskIndexKey, "-inf", "+inf"}
	}
	taskIDs, err := redis.Strings(conn.Do(commandName, args...))
	noticeError(err)
	if err != nil && err != redis.ErrNil {
		return nil, err
	}
	return taskIDs, nil
}

//RemoveTasks tasks with provided taskIds from specified source's collections.
//All task logs removed as well
func (r *Redis3Cluster) RemoveTasks(sourceID, collection string, taskIDs ...string) (int, error) {
	conn := r.cluster.Get()
	defer conn.Close()

	taskIndexKey := "sync_tasks_index:source#" + sourceID + ":collection#" + collection
	args := []interface{}{taskIndexKey} //need interface{} type to conform conn.Do method variadic signature bellow
	for _, id := range taskIDs {
		args = append(args, id)
	}

	removed, err := redis.Int(conn.Do("ZREM", args...))
	noticeError(err)
	if err != nil && err != redis.ErrNil {
		return 0, err
	}
	logging.Debugf("Removed %d of %d from index %s", removed, len(taskIDs), taskIndexKey)

	taskKeys := make([]interface{}, 0, len(taskIDs))
	for _, id := range taskIDs {
		taskKeys = append(taskKeys, "sync_tasks#"+id)
	}

	removed, err = redis.Int(conn.Do("DEL", taskKeys...))
	noticeError(err)
	if err != nil && err != redis.ErrNil {
		//no point to return error. we have already cleared index
		logging.Errorf("failed to remove tasks. source:%s collection:%s tasks:%v err:%v", sourceID, collection, taskIDs, err)
	} else {
		logging.Debugf("Removed %d of %d from tasks. source:%s collection:%s", removed, len(taskIDs), sourceID, collection)
	}
	taskLogKeys := make([]interface{}, 0, len(taskIDs))
	for _, id := range taskIDs {
		taskLogKeys = append(taskLogKeys, "sync_tasks#"+id+":logs")
	}

	removed, err = redis.Int(conn.Do("DEL", taskLogKeys...))
	noticeError(err)
	if err != nil && err != redis.ErrNil {
		//no point to return error. we have already cleared index
		logging.Errorf("failed to remove task logs. source:%s collection:%s tasks:%v err:%v", sourceID, collection, taskIDs, err)
	} else {
		logging.Debugf("Removed logs from %d of %d tasks. source:%s collection:%s", removed, len(taskIDs), sourceID, collection)
	}
	return removed, nil
}

//GetAllTasks returns all source's tasks by collection and time criteria
func (r *RedisCluster) GetAllTasks(sourceID, collection string, start, end time.Time, limit int) ([]Task, error) {
	conn := r.cluster.Get()
	defer conn.Close()

	//get index
	taskIndexKey := "sync_tasks_index:source#" + sourceID + ":collection#" + collection
	args := []interface{}{taskIndexKey, start.Unix(), end.Unix()}
	if limit > 0 {
		args = append(args, "LIMIT", 0, limit)
	}

	taskIDs, err := redis.Strings(conn.Do("ZRANGEBYSCORE", args...))
	noticeError(err)
	if err != nil && err != redis.ErrNil {
		return nil, err
	}

	var tasks []Task
	for _, taskID := range taskIDs {
		//get certain task
		taskKey := "sync_tasks#" + taskID
		task, err := redis.Values(conn.Do("HGETALL", taskKey))
		noticeError(err)
		if err != nil && err != redis.ErrNil {
			return nil, err
		}

		if len(task) > 0 {
			taskObj := Task{}
			err := redis.ScanStruct(task, &taskObj)
			if err != nil {
				return nil, fmt.Errorf("Error deserializing task struct key [%s]: %v", taskKey, err)
			}

			tasks = append(tasks, taskObj)
		}
	}

	return tasks, nil
}

//GetLastTask returns last sync task
func (r *Redis) GetLastTask(sourceID, collection string) (*Task, error) {
	conn := r.pool.Get()
	defer conn.Close()

	taskIndexKey := "sync_tasks_index:source#" + sourceID + ":collection#" + collection
	taskValues, err := redis.Strings(conn.Do("ZREVRANGEBYSCORE", taskIndexKey, "+inf", "-inf", "LIMIT", "0", "1"))
	noticeError(err)
	if err != nil && err != redis.ErrNil {
		return nil, err
	}

	if len(taskValues) == 0 {
		return nil, ErrTaskNotFound
	}

	taskID := taskValues[0]
	task, err := r.GetTask(taskID)
	if err != nil {
		if err == ErrTaskNotFound {
			logging.SystemErrorf("Task with id: %s exists in priority queue but doesn't exist in sync_task#%s record", taskID, taskID)
		}

		return nil, err
	}

	return task, err
}

//GetTask returns task by task ID or ErrTaskNotFound
func (r *Redis) GetTask(taskID string) (*Task, error) {
	conn := r.pool.Get()
	defer conn.Close()

	taskFields, err := redis.Values(conn.Do("HGETALL", "sync_tasks#"+taskID))
	noticeError(err)
	if err != nil {
		if err == redis.ErrNil {
			return nil, ErrTaskNotFound
		}

		return nil, err
	}

	if len(taskFields) == 0 {
		return nil, ErrTaskNotFound
	}

	task := &Task{}
	err = redis.ScanStruct(taskFields, task)
	if err != nil {
		return nil, fmt.Errorf("Error deserializing task entity [%s]: %v", taskID, err)
	}

	return task, nil
}

//AppendTaskLog appends log record into task logs sorted set
func (r *Redis) AppendTaskLog(taskID string, now time.Time, system, message, level string) error {
	conn := r.pool.Get()
	defer conn.Close()

	taskLogsKey := "sync_tasks#" + taskID + ":logs"
	logRecord := TaskLogRecord{
		Time:    now.Format(timestamp.Layout),
		System:  system,
		Message: message,
		Level:   level,
	}

	_, err := conn.Do("ZADD", taskLogsKey, now.Unix(), logRecord.Marshal())
	noticeError(err)
	if err != nil && err != redis.ErrNil {
		return err
	}

	return nil
}

//GetTaskLogs returns task logs with time criteria
func (r *Redis) GetTaskLogs(taskID string, start, end time.Time) ([]TaskLogRecord, error) {
	conn := r.pool.Get()
	defer conn.Close()

	taskLogsKey := "sync_tasks#" + taskID + ":logs"
	logsRecords, err := redis.Strings(conn.Do("ZRANGEBYSCORE", taskLogsKey, start.Unix(), end.Unix()))
	noticeError(err)
	if err != nil && err != redis.ErrNil {
		return nil, err
	}

	var taskLogs []TaskLogRecord
	for _, logRecord := range logsRecords {
		tlr := TaskLogRecord{}
		err := json.Unmarshal([]byte(logRecord), &tlr)
		if err != nil {
			return nil, fmt.Errorf("Error deserializing task [%s] log record: %s: %v", taskID, logRecord, err)
		}

		taskLogs = append(taskLogs, tlr)
	}

	return taskLogs, nil
}

//PollTask return task from the Queue or nil if the queue is empty
func (r *Redis) PollTask() (*Task, error) {
	conn := r.pool.Get()
	defer conn.Close()

	values, err := redis.Strings(conn.Do("ZPOPMAX", syncTasksPriorityQueueKey))
	noticeError(err)
	if err != nil {
		if err == redis.ErrNil {
			return nil, nil
		}

		return nil, err
	}

	if len(values) == 0 {
		return nil, nil
	}

	taskID := values[0]

	task, err := r.GetTask(taskID)
	if err != nil && err == ErrTaskNotFound {
		logging.SystemErrorf("Task with id: %s exists in priority queue but doesn't exist in sync_task#%s record", taskID, taskID)
	}

	return task, err
}

//PushTask saves task into priority queue
func (r *Redis) PushTask(task *Task) error {
	conn := r.pool.Get()
	defer conn.Close()

	_, err := conn.Do("ZADD", syncTasksPriorityQueueKey, task.Priority, task.ID)
	noticeError(err)
	if err != nil {
		if err == redis.ErrNil {
			return nil
		}

		return err
	}

	return nil
}

//GetProjectSourceIDs returns project's sources ids
func (r *Redis) GetProjectSourceIDs(projectID string) ([]string, error) {
	return r.getProjectIDs(projectID, sourceIndex)
}

//GetProjectDestinationIDs returns project's destination ids
func (r *Redis) GetProjectDestinationIDs(projectID string) ([]string, error) {
	return r.getProjectIDs(projectID, destinationIndex)
}

//GetEventsWithGranularity returns events amount with time criteria by granularity, status and sources/destination ids
func (r *Redis) GetEventsWithGranularity(namespace, status string, ids []string, start, end time.Time, granularity Granularity) ([]EventsPerTime, error) {
	conn := r.pool.Get()
	defer conn.Close()

	if granularity == HOUR {
		return r.getEventsPerHour(conn, namespace, status, ids, start, end)
	} else if granularity == DAY {
		return r.getEventsPerDay(conn, namespace, status, ids, start, end)
	}

	return nil, fmt.Errorf("Unknown granularity: %s", granularity.String())
}

//getEventsPerHour returns sum of sources/destinations events per hour (between start and end)
//namespace: [destination, source]
//status: [success, error, skip]
//identifiers: sources/destinations ids
func (r *Redis) getEventsPerHour(conn redis.Conn, namespace, status string, identifiers []string, start, end time.Time) ([]EventsPerTime, error) {
	eventsPerChunk := map[string]int{} //key = 2021-03-17T00:00:00+0000 | value = events count

	days := getCoveredDays(start, end)

	for _, day := range days {
		keyTime, _ := time.Parse(timestamp.DayLayout, day)

		for _, id := range identifiers {
			key := fmt.Sprintf("hourly_events:%s#%s:day#%s:%s", namespace, id, day, status)

			perHour, err := redis.IntMap(conn.Do("HGETALL", key))
			if err != nil {
				if err == redis.ErrNil {
					continue
				}

				return nil, err
			}

			if perHour == nil {
				continue
			}

			for hourStr, value := range perHour {
				hour, _ := strconv.Atoi(hourStr)
				eventsPerChunk[keyTime.Add(time.Duration(hour)*time.Hour).Format(responseTimestampLayout)] += value
			}

		}
	}

	//build response
	eventsPerTime := []EventsPerTime{}

	startDayHour := time.Date(start.Year(), start.Month(), start.Day(), start.Hour(), 0, 0, 0, time.UTC)
	for startDayHour.Before(end) {
		key := startDayHour.Format(responseTimestampLayout)
		eventsCount, ok := eventsPerChunk[key]
		if ok {
			eventsPerTime = append(eventsPerTime, EventsPerTime{
				Key:    key,
				Events: eventsCount,
			})
		}

		startDayHour = startDayHour.Add(time.Hour)
	}

	return eventsPerTime, nil
}

//getEventsPerHour returns sum of sources/destinations events per day (between start and end)
//namespace: [destination, source]
//status: [success, error, skip]
func (r *Redis) getEventsPerDay(conn redis.Conn, namespace, status string, identifiers []string, start, end time.Time) ([]EventsPerTime, error) {
	eventsPerChunk := map[string]int{} //key = 2021-03-17T00:00:00+0000 | value = events count

	months := getCoveredMonths(start, end)

	for _, month := range months {
		keyTime, _ := time.Parse(timestamp.MonthLayout, month)

		for _, id := range identifiers {
			key := fmt.Sprintf("daily_events:%s#%s:month#%s:%s", namespace, id, month, status)

			perDay, err := redis.IntMap(conn.Do("HGETALL", key))
			if err != nil {
				if err == redis.ErrNil {
					continue
				}

				return nil, err
			}

			if perDay == nil {
				continue
			}

			for dayStr, value := range perDay {
				day, _ := strconv.Atoi(dayStr)
				//add (day - 1) cause month date starts from first month's day
				eventsPerChunk[keyTime.AddDate(0, 0, day-1).Format(responseTimestampLayout)] += value
			}
		}
	}

	//build response
	eventsPerTime := []EventsPerTime{}

	startDay := time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, time.UTC)
	for startDay.Before(end) {
		key := startDay.Format(responseTimestampLayout)
		eventsCount, ok := eventsPerChunk[key]
		if ok {
			eventsPerTime = append(eventsPerTime, EventsPerTime{
				Key:    key,
				Events: eventsCount,
			})
		}

		startDay = startDay.AddDate(0, 0, 1)
	}

	return eventsPerTime, nil
}

func (r *Redis) Type() string {
	return RedisType
}

func (r *Redis) Close() error {
	return r.pool.Close()
}

//getProjectIDs returns project's entities with indexName
func (r *Redis) getProjectIDs(projectID, indexName string) ([]string, error) {
	conn := r.pool.Get()
	defer conn.Close()

	//get all IDs from index
	key := fmt.Sprintf("%s:project#%s", indexName, projectID)
	IDs, err := redis.Strings(conn.Do("SMEMBERS", key))
	if err != nil {
		if err == redis.ErrNil {
			return []string{}, nil
		}

		return nil, err
	}

	return IDs, nil
}

//ensureIDInIndex add id to corresponding index by projectID
//namespaces: [destination, source]
func (r *Redis) ensureIDInIndex(id, namespace string) error {
	conn := r.pool.Get()
	defer conn.Close()

	var indexName string
	if namespace == DestinationNamespace {
		indexName = destinationIndex
	} else if namespace == SourceNamespace {
		indexName = sourceIndex
	} else {
		return fmt.Errorf("Unknown namespace: %v", namespace)
	}

	//get projectID from id or empty
	var projectID string
	splitted := strings.Split(id, ".")
	if len(splitted) > 1 {
		projectID = splitted[0]
	}

	key := indexName + ":project#" + projectID

	_, err := conn.Do("SADD", key, id)
	noticeError(err)
	if err != nil && err != redis.ErrNil {
		return err
	}

	return nil
}

//incrementEventsCount increment events counter
//namespaces: [destination, source]
//status: [success, error, skip]
func (r *RedisCluster) incrementEventsCount(id, namespace, status string, now time.Time, value int) error {
	conn := r.cluster.Get()
	defer conn.Close()
	//increment hourly events
	dayKey := now.Format(timestamp.DayLayout)
	hourlyEventsKey := "hourly_events:" + namespace + "#" + id + ":day#" + dayKey + ":" + status
	fieldHour := strconv.Itoa(now.Hour())
	_, err := conn.Do("HINCRBY", hourlyEventsKey, fieldHour, value)
	noticeError(err)
	if err != nil && err != redis.ErrNil {
		return err
	}

	//increment daily events
	monthKey := now.Format(timestamp.MonthLayout)
	dailyEventsKey := "daily_events:" + namespace + "#" + id + ":month#" + monthKey + ":" + status
	fieldDay := strconv.Itoa(now.Day())
	_, err = conn.Do("HINCRBY", dailyEventsKey, fieldDay, value)
	noticeError(err)
	if err != nil && err != redis.ErrNil {
		return err
	}

	return nil
}
