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
	anonymousEventsSecondsTtl int
}

//redis key [variables] - description
//
//** Sources state**
//source#sourceId:collection#collectionId:chunks [sourceId, collectionId] - hashtable with signatures
//
//** Events counters **
// * per destination *
//destinations_index:project#projectId [destinationId1, destinationId2] - set of destination ids
//hourly_events:destination#destinationId:day#yyyymmdd:success [hour] - hashtable with success events counter by hour
//hourly_events:destination#destinationId:day#yyyymmdd:errors  [hour] - hashtable with error events counter by hour
//hourly_events:destination#destinationId:day#yyyymmdd:skip    [hour] - hashtable with skipped events counter by hour
//daily_events:destination#destinationId:month#yyyymm:success  [day] - hashtable with success events counter by day
//daily_events:destination#destinationId:month#yyyymm:errors   [day] - hashtable with error events counter by day
//daily_events:destination#destinationId:month#yyyymm:skip     [day] - hashtable with skipped events counter by day
//
// * per source *
//sources_index:project#projectId [sourceId1, sourceId2] - set of source ids
//daily_events:source#sourceId:month#yyyymm:success            [day] - hashtable with success events counter by day
//hourly_events:source#sourceId:day#yyyymmdd:success           [hour] - hashtable with success events counter by hour
//
//** Last events cache**
//last_events:destination#destinationId:id#eventn_ctx_event_id [original, success, error] - hashtable with original event json, processed with schema json, error json
//last_events_index:destination#destinationId [timestamp_long eventn_ctx_event_id] - sorted set of eventIds and timestamps
//
//** Retrospective user recognition **
//anonymous_events:destination_id#${destination_id}:anonymous_id#${cookies_anonymous_id} [event_id] {event JSON} - hashtable with all anonymous events
//
//** Sources Synchronization **
// - task_id = $source_$collection_$UUID
//sync_tasks_priority_queue [priority, task_id] - tasks to execute with priority
//
//sync_tasks_index:source#sourceId:collection#collectionId [timestamp_long taskId] - sorted set of taskId and timestamps
//
//sync_tasks#taskId:logs [timestamp, log record object] - sorted set of log objects and timestamps
//sync_tasks#taskId hash with fields [id, source, collection, priority, created_at, started_at, finished_at, status]

func NewRedis(host string, port int, password string, anonymousEventsMinutesTtl int) (*Redis, error) {
	if anonymousEventsMinutesTtl > 0 {
		logging.Infof("Initializing redis [%s:%d] with anonymous events ttl: %d...", host, port, anonymousEventsMinutesTtl)
	} else {
		logging.Infof("Initializing redis [%s:%d]...", host, port)
	}
	r := &Redis{pool: NewRedisPool(host, port, password), anonymousEventsSecondsTtl: anonymousEventsMinutesTtl * 60}

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

func (r *Redis) GetSignature(sourceId, collection, interval string) (string, error) {
	key := "source#" + sourceId + ":collection#" + collection + ":chunks"
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

func (r *Redis) SaveSignature(sourceId, collection, interval, signature string) error {
	key := "source#" + sourceId + ":collection#" + collection + ":chunks"
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
	err := r.ensureIdInIndex(id, namespace)
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

func (r *Redis) AddEvent(destinationId, eventId, payload string, now time.Time) (int, error) {
	conn := r.pool.Get()
	defer conn.Close()
	//add event
	lastEventsKey := "last_events:destination#" + destinationId + ":id#" + eventId
	field := "original"
	_, err := conn.Do("HSET", lastEventsKey, field, payload)
	noticeError(err)
	if err != nil && err != redis.ErrNil {
		return 0, err
	}

	//enrich index
	lastEventsIndexKey := "last_events_index:destination#" + destinationId
	_, err = conn.Do("ZADD", lastEventsIndexKey, now.Unix(), eventId)
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

func (r *Redis) UpdateSucceedEvent(destinationId, eventId, success string) error {
	lastEventsKey := "last_events:destination#" + destinationId + ":id#" + eventId

	conn := r.pool.Get()
	defer conn.Close()

	_, err := updateTwoFieldsCachedEvent.Do(conn, lastEventsKey, "success", success, "error", "")
	noticeError(err)
	if err != nil && err != redis.ErrNil {
		return err
	}

	return nil
}

func (r *Redis) UpdateErrorEvent(destinationId, eventId, error string) error {
	lastEventsKey := "last_events:destination#" + destinationId + ":id#" + eventId

	conn := r.pool.Get()
	defer conn.Close()

	_, err := updateOneFieldCachedEvent.Do(conn, lastEventsKey, "error", error)
	noticeError(err)
	if err != nil && err != redis.ErrNil {
		return err
	}

	return nil
}

func (r *Redis) RemoveLastEvent(destinationId string) error {
	conn := r.pool.Get()
	defer conn.Close()
	//remove last event from index
	lastEventsIndexKey := "last_events_index:destination#" + destinationId
	values, err := redis.Strings(conn.Do("ZPOPMIN", lastEventsIndexKey))
	noticeError(err)
	if err != nil && err != redis.ErrNil {
		return err
	}

	if len(values) != 2 {
		return fmt.Errorf("Error response format: %v", values)
	}

	eventId := values[0]

	lastEventsKey := "last_events:destination#" + destinationId + ":id#" + eventId
	_, err = conn.Do("DEL", lastEventsKey)
	noticeError(err)
	if err != nil && err != redis.ErrNil {
		return err
	}

	return nil
}

func (r *Redis) GetEvents(destinationId string, start, end time.Time, n int) ([]Event, error) {
	conn := r.pool.Get()
	defer conn.Close()

	//get index
	lastEventsIndexKey := "last_events_index:destination#" + destinationId
	eventIds, err := redis.Strings(conn.Do("ZRANGEBYSCORE", lastEventsIndexKey, start.Unix(), end.Unix(), "LIMIT", 0, n))
	noticeError(err)
	if err != nil && err != redis.ErrNil {
		return nil, err
	}

	events := []Event{}
	for _, eventId := range eventIds {
		lastEventsKey := "last_events:destination#" + destinationId + ":id#" + eventId
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

func (r *Redis) GetTotalEvents(destinationId string) (int, error) {
	conn := r.pool.Get()
	defer conn.Close()

	lastEventsIndexKey := "last_events_index:destination#" + destinationId
	count, err := redis.Int(conn.Do("ZCOUNT", lastEventsIndexKey, "-inf", "+inf"))
	noticeError(err)
	if err != nil && err != redis.ErrNil {
		return 0, err
	}

	return count, nil
}

func (r *Redis) SaveAnonymousEvent(destinationId, anonymousId, eventId, payload string) error {
	conn := r.pool.Get()
	defer conn.Close()
	//add event
	anonymousEventKey := "anonymous_events:destination_id#" + destinationId + ":anonymous_id#" + anonymousId
	_, err := conn.Do("HSET", anonymousEventKey, eventId, payload)
	noticeError(err)
	if err != nil && err != redis.ErrNil {
		return err
	}

	if r.anonymousEventsSecondsTtl > 0 {
		_, err := conn.Do("EXPIRE", anonymousEventKey, r.anonymousEventsSecondsTtl)
		noticeError(err)
		if err != nil && err != redis.ErrNil {
			logging.SystemErrorf("Error EXPIRE anonymous event %s %s: %v", anonymousEventKey, eventId, err)
		}
	}

	return nil
}

func (r *Redis) GetAnonymousEvents(destinationId, anonymousId string) (map[string]string, error) {
	conn := r.pool.Get()
	defer conn.Close()
	//get events
	anonymousEventKey := "anonymous_events:destination_id#" + destinationId + ":anonymous_id#" + anonymousId

	eventsMap, err := redis.StringMap(conn.Do("HGETALL", anonymousEventKey))
	noticeError(err)
	if err != nil && err != redis.ErrNil {
		return nil, err
	}

	return eventsMap, nil
}

func (r *Redis) DeleteAnonymousEvent(destinationId, anonymousId, eventId string) error {
	conn := r.pool.Get()
	defer conn.Close()

	//remove event
	anonymousEventKey := "anonymous_events:destination_id#" + destinationId + ":anonymous_id#" + anonymousId
	_, err := conn.Do("HDEL", anonymousEventKey, eventId)
	noticeError(err)
	if err != nil && err != redis.ErrNil {
		return err
	}

	return nil
}

func (r *Redis) CreateTask(sourceId, collection string, task *Task, createdAt time.Time) error {
	err := r.UpsertTask(task)
	if err != nil {
		return err
	}

	conn := r.pool.Get()
	defer conn.Close()

	//enrich index
	taskIndexKey := "sync_tasks_index:source#" + sourceId + ":collection#" + collection
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

func (r *Redis) GetAllTasks(sourceId, collection string, start, end time.Time) ([]Task, error) {
	conn := r.pool.Get()
	defer conn.Close()

	//get index
	taskIndexKey := "sync_tasks_index:source#" + sourceId + ":collection#" + collection
	taskIds, err := redis.Strings(conn.Do("ZRANGEBYSCORE", taskIndexKey, start.Unix(), end.Unix()))
	noticeError(err)
	if err != nil && err != redis.ErrNil {
		return nil, err
	}

	var tasks []Task
	for _, taskId := range taskIds {
		//get certain task
		taskKey := "sync_tasks#" + taskId
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

func (r *Redis) GetLastTask(sourceId, collection string) (*Task, error) {
	conn := r.pool.Get()
	defer conn.Close()

	taskIndexKey := "sync_tasks_index:source#" + sourceId + ":collection#" + collection
	taskValues, err := redis.Strings(conn.Do("ZREVRANGEBYSCORE", taskIndexKey, "+inf", "-inf", "LIMIT", "0", "1"))
	noticeError(err)
	if err != nil && err != redis.ErrNil {
		return nil, err
	}

	if len(taskValues) == 0 {
		return nil, ErrTaskNotFound
	}

	taskId := taskValues[0]
	task, err := r.GetTask(taskId)
	if err != nil {
		if err == ErrTaskNotFound {
			logging.SystemErrorf("Task with id: %s exists in priority queue but doesn't exist in sync_task#%s record", taskId, taskId)
		}

		return nil, err
	}

	return task, err
}

func (r *Redis) GetTask(taskId string) (*Task, error) {
	conn := r.pool.Get()
	defer conn.Close()

	taskFields, err := redis.Values(conn.Do("HGETALL", "sync_tasks#"+taskId))
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
		return nil, fmt.Errorf("Error deserializing task entity [%s]: %v", taskId, err)
	}

	return task, nil
}

func (r *Redis) AppendTaskLog(taskId string, now time.Time, message, level string) error {
	conn := r.pool.Get()
	defer conn.Close()

	taskLogsKey := "sync_tasks#" + taskId + ":logs"
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

func (r *Redis) GetTaskLogs(taskId string, start, end time.Time) ([]TaskLogRecord, error) {
	conn := r.pool.Get()
	defer conn.Close()

	taskLogsKey := "sync_tasks#" + taskId + ":logs"
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
			return nil, fmt.Errorf("Error deserializing task [%s] log record: %s: %v", taskId, logRecord, err)
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

	taskId := values[0]

	task, err := r.GetTask(taskId)
	if err != nil && err == ErrTaskNotFound {
		logging.SystemErrorf("Task with id: %s exists in priority queue but doesn't exist in sync_task#%s record", taskId, taskId)
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

func (r *Redis) IsTaskInQueue(sourceId, collection string) (string, bool, error) {
	conn := r.pool.Get()
	defer conn.Close()

	iter := 0
	var taskId string
	for {
		values, err := redis.Values(conn.Do("ZSCAN", syncTasksPriorityQueueKey, iter, "MATCH", fmt.Sprintf("%s_%s_*", sourceId, collection)))
		noticeError(err)
		if err != nil {
			return "", false, err
		}

		iter, _ = redis.Int(values[0], nil)
		resultArr, _ := redis.Strings(values[1], nil)
		if len(resultArr) > 0 {
			taskId = resultArr[0]
			break
		}

		if iter == 0 {
			break
		}
	}

	return taskId, len(taskId) > 0, nil
}

func (r *Redis) Type() string {
	return RedisType
}

func (r *Redis) Close() error {
	return r.pool.Close()
}

//ensureIdInIndex add id to corresponding index by projectId
//namespaces: [destination, source]
func (r *Redis) ensureIdInIndex(id, namespace string) error {
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

	//get projectId from id or empty
	var projectId string
	splitted := strings.Split(id, ".")
	if len(splitted) > 1 {
		projectId = splitted[0]
	}

	key := indexName + ":project#" + projectId

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
