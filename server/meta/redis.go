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
	PushSourceNamespace       = "push_source"

	destinationIndex = "destinations_index"
	sourceIndex      = "sources_index"
	//all api keys - push events
	pushSourceIndex = "push_sources_index"

	syncTasksPrefix  = "sync_tasks#"
	taskHeartBeatKey = "sync_tasks_heartbeat"

	responseTimestampLayout = "2006-01-02T15:04:05+0000"

	SuccessStatus = "success"
	ErrorStatus   = "errors"
	SkipStatus    = "skip"
)

var (
	ErrTaskNotFound = errors.New("Sync task wasn't found")
)

type Redis struct {
	pool                      *RedisPool
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
//sources_index:project#projectID                    [sourceID1, sourceID2] - set of source ids
//daily_events:source#sourceID:month#yyyymm:success            [day] - hashtable with success events counter by day
//hourly_events:source#sourceID:day#yyyymmdd:success           [hour] - hashtable with success events counter by hour
// * per push source *
//push_sources_index:project#projectID                         [sourceID1, sourceID2] - set of only pushed source ids (api keys) for billing
//daily_events:push_source#sourceID:month#yyyymm:success            [day] - hashtable with success events counter by day
//hourly_events:push_source#sourceID:day#yyyymmdd:success           [hour] - hashtable with success events counter by hour
//
//** Last events cache**
//last_events:destination#destinationID:id#unique_id_field [original, success, error] - hashtable with original event json, processed with schema json, error json
//last_events_index:destination#destinationID [timestamp_long unique_id_field] - sorted set of eventIDs and timestamps
//
//** Retroactive user recognition **
//anonymous_events:destination_id#${destination_id}:anonymous_id#${cookies_anonymous_id} [event_id] {event JSON} - hashtable with all anonymous events
//
//** Sources Synchronization **
// - task_id = $source_$collection_$UUID
//sync_tasks_heartbeat [task_id] last_timestamp - hashtable with hash=task_id and value = last_timestamp.
//
//sync_tasks_priority_queue [priority, task_id] - tasks to execute with priority
//
//sync_tasks_index:source#sourceID:collection#collectionID [timestamp_long taskID] - sorted set of taskID and timestamps
//
//sync_tasks#taskID:logs [timestamp, log record object] - sorted set of log objects and timestamps
//sync_tasks#taskID hash with fields [id, source, collection, priority, created_at, started_at, finished_at, status]

//NewRedis returns configured Redis struct with connection pool
func NewRedis(factory *RedisPoolFactory, anonymousEventsMinutesTTL int) (*Redis, error) {
	if anonymousEventsMinutesTTL > 0 {
		logging.Infof("🏪 Initializing meta storage redis [%s] with anonymous events ttl: %d...", factory.Details(), anonymousEventsMinutesTTL)
	} else {
		logging.Infof("🏪 Initializing meta storage redis [%s]...", factory.Details())
	}

	pool, err := factory.Create()
	if err != nil {
		return nil, err
	}

	return &Redis{pool: pool, anonymousEventsSecondsTTL: anonymousEventsMinutesTTL * 60}, nil
}

//GetSignature returns sync interval signature from Redis
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

//SaveSignature saves sync interval signature in Redis
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

//DeleteSignature deletes source collection signature from Redis
func (r *Redis) DeleteSignature(sourceID, collection string) error {
	key := "source#" + sourceID + ":collection#" + collection + ":chunks"
	connection := r.pool.Get()
	defer connection.Close()
	_, err := connection.Do("DEL", key)
	noticeError(err)
	if err != nil && err != redis.ErrNil {
		return err
	}

	return nil
}

//SuccessEvents ensures that id is in the index and increments success events counter
func (r *Redis) SuccessEvents(id, namespace string, now time.Time, value int) error {
	err := r.ensureIDInIndex(id, namespace)
	if err != nil {
		return fmt.Errorf("Error ensuring id in index: %v", err)
	}
	return r.incrementEventsCount(id, namespace, SuccessStatus, now, value)
}

//ErrorEvents increments error events counter
func (r *Redis) ErrorEvents(id, namespace string, now time.Time, value int) error {
	return r.incrementEventsCount(id, namespace, ErrorStatus, now, value)
}

//SkipEvents increments skipp events counter
func (r *Redis) SkipEvents(id, namespace string, now time.Time, value int) error {
	return r.incrementEventsCount(id, namespace, SkipStatus, now, value)
}

//AddEvent saves event JSON string into Redis and ensures that event ID is in index by destination ID
//returns index length
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

//UpdateSucceedEvent updates event record in Redis with success field = JSON of succeed event
func (r *Redis) UpdateSucceedEvent(destinationID, eventID, success string) error {
	lastEventsKey := "last_events:destination#" + destinationID + ":id#" + eventID
	lastEventsIndexKey := "last_events_index:destination#" + destinationID
	originalEventKey := "last_events:destination#" + destinationID + ":id#" + extractOriginalEventId(eventID)

	conn := r.pool.Get()
	defer conn.Close()

	_, err := updateThreeFieldsCachedEvent.Do(conn, lastEventsKey, "success", success, "error", "", "destination_id", destinationID, lastEventsIndexKey, time.Now().UTC().Unix(), eventID, originalEventKey)
	noticeError(err)
	if err != nil && err != redis.ErrNil {
		return err
	}

	return nil
}

//UpdateErrorEvent updates event record in Redis with error field = error string
func (r *Redis) UpdateErrorEvent(destinationID, eventID, error string) error {
	lastEventsKey := "last_events:destination#" + destinationID + ":id#" + eventID
	lastEventsIndexKey := "last_events_index:destination#" + destinationID
	originalEventKey := "last_events:destination#" + destinationID + ":id#" + extractOriginalEventId(eventID)

	conn := r.pool.Get()
	defer conn.Close()

	_, err := updateTwoFieldsCachedEvent.Do(conn, lastEventsKey, "error", error, "destination_id", destinationID, lastEventsIndexKey, time.Now().UTC().Unix(), eventID, originalEventKey)
	noticeError(err)
	if err != nil && err != redis.ErrNil {
		return err
	}

	return nil
}

//UpdateSkipEvent updates event record in Redis with skip field = error string
func (r *Redis) UpdateSkipEvent(destinationID, eventID, error string) error {
	lastEventsKey := "last_events:destination#" + destinationID + ":id#" + eventID
	lastEventsIndexKey := "last_events_index:destination#" + destinationID
	originalEventKey := "last_events:destination#" + destinationID + ":id#" + extractOriginalEventId(eventID)
	conn := r.pool.Get()
	defer conn.Close()

	_, err := updateThreeFieldsCachedEvent.Do(conn, lastEventsKey, "skip", error, "error", "", "destination_id", destinationID, lastEventsIndexKey, time.Now().UTC().Unix(), eventID, originalEventKey)
	noticeError(err)
	if err != nil && err != redis.ErrNil {
		return err
	}

	return nil
}

//RemoveLastEvent removes last event from index and delete it from Redis
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

//GetEvents returns destination's last events with time criteria
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

//GetTotalEvents returns total of cached events
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

//SaveAnonymousEvent saves event JSON by destination ID and user anonymous ID key
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

//GetAnonymousEvents returns events JSON per event ID map
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

//DeleteAnonymousEvent deletes event with eventID
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

//CreateTask saves task into Redis and add Task ID in index
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

//UpsertTask overwrite task in Redis (save or update)
func (r *Redis) UpsertTask(task *Task) error {
	conn := r.pool.Get()
	defer conn.Close()

	//save task
	taskKey := syncTasksPrefix + task.ID
	_, err := conn.Do("HMSET", redis.Args{taskKey}.AddFlat(task)...)
	noticeError(err)
	if err != nil && err != redis.ErrNil {
		return err
	}

	return nil
}

//GetAllTaskIDs returns all source's tasks ids by collection
func (r *Redis) GetAllTaskIDs(sourceID, collection string, descendingOrder bool) ([]string, error) {
	conn := r.pool.Get()
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
func (r *Redis) RemoveTasks(sourceID, collection string, taskIDs ...string) (int, error) {
	conn := r.pool.Get()
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
		taskKeys = append(taskKeys, syncTasksPrefix+id)
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
		taskLogKeys = append(taskLogKeys, syncTasksPrefix+id+":logs")
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

//TaskHeartBeat sets current timestamp into heartbeat key
func (r *Redis) TaskHeartBeat(taskID string) error {
	conn := r.pool.Get()
	defer conn.Close()

	_, err := conn.Do("HSET", taskHeartBeatKey, taskID, timestamp.NowUTC())
	noticeError(err)
	if err != nil && err != redis.ErrNil {
		return err
	}

	return nil
}

//RemoveTaskFromHeartBeat removes taskID current timestamp from heartbeat key
func (r *Redis) RemoveTaskFromHeartBeat(taskID string) error {
	conn := r.pool.Get()
	defer conn.Close()

	_, err := conn.Do("HDEL", taskHeartBeatKey, taskID)
	noticeError(err)
	if err != nil && err != redis.ErrNil {
		return err
	}

	return nil
}

//GetAllTasksHeartBeat returns map with taskID-last heartbeat timestamp pairs
func (r *Redis) GetAllTasksHeartBeat() (map[string]string, error) {
	conn := r.pool.Get()
	defer conn.Close()

	tasksHeartBeat, err := redis.StringMap(conn.Do("HGETALL", taskHeartBeatKey))
	noticeError(err)
	if err != nil {
		if err == redis.ErrNil {
			return map[string]string{}, nil
		}

		return nil, err
	}

	return tasksHeartBeat, nil
}

//GetAllTasksForInitialHeartbeat returns all task IDs where:
//1. task is RUNNING and last log time more than last activity threshold
//2. task is SCHEDULED and task creation time more than last activity threshold
func (r *Redis) GetAllTasksForInitialHeartbeat(runningStatus, scheduledStatus string, lastActivityThreshold time.Duration) ([]string, error) {
	conn := r.pool.Get()
	defer conn.Close()

	//the task is stalled if last activity was before current time - lastActivityThreshold
	stalledTime := time.Now().UTC().Truncate(lastActivityThreshold)

	var taskIDs []string
	cursor := 0

	for {
		scannedResult, err := redis.Values(conn.Do("SCAN", cursor, "MATCH", syncTasksPrefix+"*", "TYPE", "hash", "COUNT", 50000))
		if err != nil {
			noticeError(err)
			if err != nil && err != redis.ErrNil {
				return nil, err
			}
		}

		if len(scannedResult) != 2 {
			return nil, fmt.Errorf("error len of SCAN result: %v", scannedResult)
		}

		cursor, _ = redis.Int(scannedResult[0], nil)
		taskKeysOutput, _ := redis.Strings(scannedResult[1], nil)

		for _, taskKey := range taskKeysOutput {
			taskID := strings.TrimPrefix(taskKey, syncTasksPrefix)

			//filter by status
			task, err := r.getTask(conn, taskID)
			if err != nil {
				if err == ErrTaskNotFound {
					logging.SystemErrorf("task [%s] wasn't found in initial heartbeat", taskID)
					continue
				}

				return nil, err
			}

			if task.Status == runningStatus {
				ok, err := r.filterStalledTaskInRunningStatus(conn, task, stalledTime)
				if err != nil {
					return nil, err
				}

				if ok {
					taskIDs = append(taskIDs, taskID)
				}
			} else if task.Status == scheduledStatus {
				ok, err := r.filterStalledTaskInScheduledStatus(task, stalledTime)
				if err != nil {
					return nil, err
				}

				if ok {
					taskIDs = append(taskIDs, taskID)
				}
			}
		}

		//end of cycle
		if cursor == 0 {
			break
		}
	}

	return taskIDs, nil
}

//filterStalledTaskInRunningStatus gets last logs and compares with stalledTime. If there is no logs, compare task creation time
//returns true if task is stalled
func (r *Redis) filterStalledTaskInRunningStatus(conn redis.Conn, task *Task, stalledTime time.Time) (bool, error) {
	lastLogArr, err := redis.Values(conn.Do("ZREVRANGEBYSCORE", syncTasksPrefix+task.ID+":logs", time.Now().Unix(), 0, "LIMIT", 0, 1, "WITHSCORES"))
	if err != nil {
		noticeError(err)
		if err != nil && err != redis.ErrNil {
			return false, err
		}
	}

	//by last log
	if len(lastLogArr) == 2 {
		lastLogTimeUnix, _ := redis.Int(lastLogArr[1], nil)
		lastLogTime := time.Unix(int64(lastLogTimeUnix), 0)
		return lastLogTime.Before(stalledTime), nil
	}

	//by started time
	startedAt, err := time.Parse(time.RFC3339Nano, task.StartedAt)
	if err != nil {
		return false, fmt.Errorf("error parsing started_at [%s] of task [%s] as time: %v", task.StartedAt, task.ID, err)
	}

	return startedAt.Before(stalledTime), nil
}

//filterStalledTaskInScheduledStatus gets task creation time and compares with stalledTime
//returns true if task is stalled
func (r *Redis) filterStalledTaskInScheduledStatus(task *Task, stalledTime time.Time) (bool, error) {
	createdAt, err := time.Parse(time.RFC3339Nano, task.CreatedAt)
	if err != nil {
		return false, fmt.Errorf("error parsing created_at [%s] of task [%s] as time: %v", task.StartedAt, task.ID, err)
	}

	return createdAt.Before(stalledTime), nil
}

//GetAllTasks returns all source's tasks by collection and time criteria
func (r *Redis) GetAllTasks(sourceID, collection string, start, end time.Time, limit int) ([]Task, error) {
	conn := r.pool.Get()
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
		taskKey := syncTasksPrefix + taskID
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
	task, err := r.getTask(conn, taskID)
	if err != nil {
		if err == ErrTaskNotFound {
			logging.SystemErrorf("Task with id: %s exists in priority queue but doesn't exist in sync_task#%s record", taskID, taskID)
		}

		return nil, err
	}

	return task, err
}

//GetTask opens connection and returns result of getTask
func (r *Redis) GetTask(taskID string) (*Task, error) {
	conn := r.pool.Get()
	defer conn.Close()

	return r.getTask(conn, taskID)
}

//getTask returns task by task ID or ErrTaskNotFound
func (r *Redis) getTask(conn redis.Conn, taskID string) (*Task, error) {
	taskFields, err := redis.Values(conn.Do("HGETALL", syncTasksPrefix+taskID))
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

	taskLogsKey := syncTasksPrefix + taskID + ":logs"
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

	taskLogsKey := syncTasksPrefix + taskID + ":logs"
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

	task, err := r.getTask(conn, taskID)
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

//GetProjectPushSourceIDs returns project's pushed sources ids (api keys)
func (r *Redis) GetProjectPushSourceIDs(projectID string) ([]string, error) {
	return r.getProjectIDs(projectID, pushSourceIndex)
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
	switch namespace {
	case DestinationNamespace:
		indexName = destinationIndex
	case SourceNamespace:
		indexName = sourceIndex
	case PushSourceNamespace:
		indexName = pushSourceIndex
	default:
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

func noticeError(err error) {
	if err != nil {
		if err == redis.ErrPoolExhausted {
			metrics.MetaRedisErrors("ERR_POOL_EXHAUSTED")
		} else if err == redis.ErrNil {
			metrics.MetaRedisErrors("ERR_NIL")
		} else if strings.Contains(strings.ToLower(err.Error()), "timeout") {
			metrics.MetaRedisErrors("ERR_TIMEOUT")
		} else {
			metrics.MetaRedisErrors("UNKNOWN")
			logging.Error("Unknown redis error:", err)
		}
	}
}

//getCoveredDays return array of YYYYMMDD day strings which are covered input interval
func getCoveredDays(start, end time.Time) []string {
	days := []string{start.Format(timestamp.DayLayout)}

	day := start.Day()
	for start.Before(end) {
		start = start.Add(time.Hour)
		nextDay := start.Day()
		if nextDay != day {
			days = append(days, start.Format(timestamp.DayLayout))
		}
		day = nextDay
	}

	return days
}

//getCoveredMonths return array of YYYYMM month strings which are covered input interval
func getCoveredMonths(start, end time.Time) []string {
	months := []string{start.Format(timestamp.MonthLayout)}

	month := start.Month()
	for start.Before(end) {
		start = start.Add(time.Hour * 24)
		nextMonth := start.Month()
		if nextMonth != month {
			months = append(months, start.Format(timestamp.MonthLayout))
		}
		month = nextMonth
	}

	return months
}

func extractOriginalEventId(eventId string) string {
	if parts := strings.Split(eventId, "_"); len(parts) == 2 {
		return parts[0]
	}
	return eventId
}
