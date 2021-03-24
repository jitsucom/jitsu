package meta

import (
	"encoding/json"
	"errors"
	"fmt"
	"github.com/gomodule/redigo/redis"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/metrics"
	"github.com/jitsucom/jitsu/server/timestamp"
	"strconv"
	"strings"
	"time"
)

const (
	syncTasksPriorityQueueKey = "sync_tasks_priority_queue"
	DestinationNamespace      = "destination"
	SourceNamespace           = "source"

	destinationIndex = "destinations_index"
	sourceIndex      = "sources_index"
)

var ErrTaskNotFound = errors.New("Sync task wasn't found")

type Redis struct {
	pool                      *redis.Pool
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
//last_events:destination#destinationID:id#eventn_ctx_event_id [original, success, error] - hashtable with original event json, processed with schema json, error json
//last_events_index:destination#destinationID [timestamp_long eventn_ctx_event_id] - sorted set of eventIDs and timestamps
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

func NewRedis(host string, port int, password string, anonymousEventsMinutesTTL int) (*Redis, error) {
	if anonymousEventsMinutesTTL > 0 {
		logging.Infof("Initializing redis [%s:%d] with anonymous events ttl: %d...", host, port, anonymousEventsMinutesTTL)
	} else {
		logging.Infof("Initializing redis [%s:%d]...", host, port)
	}
	r := &Redis{pool: NewRedisPool(host, port, password), anonymousEventsSecondsTTL: anonymousEventsMinutesTTL * 60}

	//test connection
	connection := r.pool.Get()
	defer connection.Close()
	_, err := redis.String(connection.Do("PING"))
	if err != nil {
		return nil, fmt.Errorf("Error testing connection to Redis: %v", err)
	}

	return r, nil
}

func NewRedisPool(host string, port int, password string) *redis.Pool {
	return &redis.Pool{
		MaxIdle:     100,
		MaxActive:   600,
		IdleTimeout: 240 * time.Second,

		Wait: false,
		Dial: func() (redis.Conn, error) {
			c, err := redis.Dial(
				"tcp",
				host+":"+strconv.Itoa(port),
				redis.DialConnectTimeout(10*time.Second),
				redis.DialReadTimeout(10*time.Second),
				redis.DialPassword(password),
			)
			if err != nil {
				return nil, err
			}
			return c, err
		},
		TestOnBorrow: func(c redis.Conn, t time.Time) error {
			_, err := c.Do("PING")
			return err
		},
	}
}

func (r *Redis) GetSignature(sourceID, collection, interval string) (string, error) {
	key := "source#" + sourceID + ":collection#" + collection + ":chunks"
	field := interval
	connection := r.pool.Get()
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

func (r *Redis) SaveSignature(sourceID, collection, interval, signature string) error {
	key := "source#" + sourceID + ":collection#" + collection + ":chunks"
	field := interval
	connection := r.pool.Get()
	defer connection.Close()
	_, err := connection.Do("HSET", key, field, signature)
	noticeError(err)
	if err != nil && err != redis.ErrNil {
		return err
	}

	return nil
}

func (r *Redis) SuccessEvents(id, namespace string, now time.Time, value int) error {
	err := r.ensureIDInIndex(id, namespace)
	if err != nil {
		return fmt.Errorf("Error ensuring id in index: %v", err)
	}
	return r.incrementEventsCount(id, namespace, "success", now, value)
}

func (r *Redis) ErrorEvents(id, namespace string, now time.Time, value int) error {
	return r.incrementEventsCount(id, namespace, "errors", now, value)
}

func (r *Redis) SkipEvents(id, namespace string, now time.Time, value int) error {
	return r.incrementEventsCount(id, namespace, "skip", now, value)
}

func (r *Redis) AddEvent(destinationID, eventID, payload string, now time.Time) (int, error) {
	conn := r.pool.Get()
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

func (r *Redis) UpdateSucceedEvent(destinationID, eventID, success string) error {
	lastEventsKey := "last_events:destination#" + destinationID + ":id#" + eventID

	conn := r.pool.Get()
	defer conn.Close()

	_, err := updateTwoFieldsCachedEvent.Do(conn, lastEventsKey, "success", success, "error", "")
	noticeError(err)
	if err != nil && err != redis.ErrNil {
		return err
	}

	return nil
}

func (r *Redis) UpdateErrorEvent(destinationID, eventID, error string) error {
	lastEventsKey := "last_events:destination#" + destinationID + ":id#" + eventID

	conn := r.pool.Get()
	defer conn.Close()

	_, err := updateOneFieldCachedEvent.Do(conn, lastEventsKey, "error", error)
	noticeError(err)
	if err != nil && err != redis.ErrNil {
		return err
	}

	return nil
}

func (r *Redis) RemoveLastEvent(destinationID string) error {
	conn := r.pool.Get()
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

func (r *Redis) GetEvents(destinationID string, start, end time.Time, n int) ([]Event, error) {
	conn := r.pool.Get()
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

func (r *Redis) GetTotalEvents(destinationID string) (int, error) {
	conn := r.pool.Get()
	defer conn.Close()

	lastEventsIndexKey := "last_events_index:destination#" + destinationID
	count, err := redis.Int(conn.Do("ZCOUNT", lastEventsIndexKey, "-inf", "+inf"))
	noticeError(err)
	if err != nil && err != redis.ErrNil {
		return 0, err
	}

	return count, nil
}

func (r *Redis) SaveAnonymousEvent(destinationID, anonymousID, eventID, payload string) error {
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

func (r *Redis) GetAnonymousEvents(destinationID, anonymousID string) (map[string]string, error) {
	conn := r.pool.Get()
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

func (r *Redis) DeleteAnonymousEvent(destinationID, anonymousID, eventID string) error {
	conn := r.pool.Get()
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

func (r *Redis) CreateTask(sourceID, collection string, task *Task, createdAt time.Time) error {
	err := r.UpsertTask(task)
	if err != nil {
		return err
	}

	conn := r.pool.Get()
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

func (r *Redis) UpsertTask(task *Task) error {
	conn := r.pool.Get()
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

func (r *Redis) GetAllTasks(sourceID, collection string, start, end time.Time) ([]Task, error) {
	conn := r.pool.Get()
	defer conn.Close()

	//get index
	taskIndexKey := "sync_tasks_index:source#" + sourceID + ":collection#" + collection
	taskIDs, err := redis.Strings(conn.Do("ZRANGEBYSCORE", taskIndexKey, start.Unix(), end.Unix()))
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

func (r *Redis) AppendTaskLog(taskID string, now time.Time, message, level string) error {
	conn := r.pool.Get()
	defer conn.Close()

	taskLogsKey := "sync_tasks#" + taskID + ":logs"
	logRecord := TaskLogRecord{
		Time:    now.Format(timestamp.Layout),
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

func (r *Redis) IsTaskInQueue(sourceID, collection string) (string, bool, error) {
	conn := r.pool.Get()
	defer conn.Close()

	iter := 0
	var taskID string
	for {
		values, err := redis.Values(conn.Do("ZSCAN", syncTasksPriorityQueueKey, iter, "MATCH", fmt.Sprintf("%s_%s_*", sourceID, collection)))
		noticeError(err)
		if err != nil {
			return "", false, err
		}

		iter, _ = redis.Int(values[0], nil)
		resultArr, _ := redis.Strings(values[1], nil)
		if len(resultArr) > 0 {
			taskID = resultArr[0]
			break
		}

		if iter == 0 {
			break
		}
	}

	return taskID, len(taskID) > 0, nil
}

func (r *Redis) Type() string {
	return RedisType
}

func (r *Redis) Close() error {
	return r.pool.Close()
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
func (r *Redis) incrementEventsCount(id, namespace, status string, now time.Time, value int) error {
	conn := r.pool.Get()
	defer conn.Close()
	//increment hourly events
	dayKey := now.Format(timestamp.DayLayout)
	hourlyEventsKey := "hourly_events:" + namespace + "#" + id + ":day#" + dayKey + ":" + status
	fieldHour := strconv.Itoa(now.Hour())
	_, err := conn.Do("HINCRBY", hourlyEventsKey, fieldHour, 1)
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

func noticeError(err error) {
	if err != nil {
		if err == redis.ErrPoolExhausted {
			metrics.RedisErrors("ERR_POOL_EXHAUSTED")
		} else if err == redis.ErrNil {
			metrics.RedisErrors("ERR_NIL")
		} else if strings.Contains(strings.ToLower(err.Error()), "timeout") {
			metrics.RedisErrors("ERR_TIMEOUT")
		} else {
			metrics.RedisErrors("UNKNOWN")
			logging.Error("Unknown redis error:", err)
		}
	}
}
