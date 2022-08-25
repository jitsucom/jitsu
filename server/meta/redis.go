package meta

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/gomodule/redigo/redis"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/metrics"
	"github.com/jitsucom/jitsu/server/timestamp"
)

const (
	syncTasksPriorityQueueKey = "sync_tasks_priority_queue"

	DestinationNamespace = "destination"
	SourceNamespace      = "source"

	//536-issue DEPRECATED
	//instead of this name - all sources will be in SourceNamespace and for push/pull events different keys will be selected
	PushSourceNamespace = "push_source"

	destinationIndex = "destinations_index"
	sourceIndex      = "sources_index"

	//536-issue DEPRECATED
	//all api keys - push events
	//instead of this name - all sources will be in SourceNamespace and for push/pull events different keys will be selected
	pushSourceIndex = "push_sources_index"

	syncTasksPrefix  = "sync_tasks#"
	taskHeartBeatKey = "sync_tasks_heartbeat"

	responseTimestampLayout = "2006-01-02T15:04:05+0000"

	PushEventType = "push"
	PullEventType = "pull"

	SuccessStatus = "success"
	ErrorStatus   = "errors"
	SkipStatus    = "skip"

	ConfigPrefix = "config#"
	SystemKey    = "system"

	EventsTokenNamespace       = "token"
	EventsDestinationNamespace = "destination"
	EventsErrorStatus          = "error"
	EventsPureStatus           = ""
)

var (
	ErrTaskNotFound = errors.New("Sync task wasn't found")
)

type Redis struct {
	pool         *RedisPool
	errorMetrics *ErrorMetrics
}

//redis key [variables] - description
//
//** Sources state**
//source#sourceID:collection#collectionID:chunks [sourceID, collectionID] - hashtable with signatures
//
//** Events counters **
// * per destination *
//destinations_index:project#projectID [destinationID1, destinationID2] - set of destination ids
//hourly_events:destination#destinationID:type#eventType:day#yyyymmdd:success [hour] - hashtable with success events counter by hour
//hourly_events:destination#destinationID:type#eventType:day#yyyymmdd:errors  [hour] - hashtable with error events counter by hour
//hourly_events:destination#destinationID:type#eventType:day#yyyymmdd:skip    [hour] - hashtable with skipped events counter by hour
//daily_events:destination#destinationID:type#eventType:month#yyyymm:success  [day] - hashtable with success events counter by day
//daily_events:destination#destinationID:type#eventType:month#yyyymm:errors   [day] - hashtable with error events counter by day
//daily_events:destination#destinationID:type#eventType:month#yyyymm:skip     [day] - hashtable with skipped events counter by day
//
// * per source *
//sources_index:project#projectID                    [sourceID1, sourceID2] - set of source ids
//daily_events:source#sourceID:type#eventType:month#yyyymm:success            [day] - hashtable with success events counter by day
//hourly_events:source#sourceID:type#eventType:day#yyyymmdd:success           [hour] - hashtable with success events counter by hour
// * per push source *
//push_sources_index:project#projectID                         [sourceID1, sourceID2] - set of only pushed source ids (api keys) for billing
//daily_events:push_source#sourceID:month#yyyymm:success            [day] - hashtable with success events counter by day
//hourly_events:push_source#sourceID:day#yyyymmdd:success           [hour] - hashtable with success events counter by hour
//
//** Events cache**
//events_cache:destination#destinationID - sorted (desc by inserted time) list of destination Events that have statuses (success, failed, skip).
//events_cache:token#tokenID - sorted (desc by inserted time) list of token raw JSON Events that don't have statuses
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

// NewRedis returns configured Redis struct with connection pool
func NewRedis(pool *RedisPool) *Redis {
	return &Redis{pool: pool, errorMetrics: NewErrorMetrics(metrics.MetaRedisErrors)}
}

// GetSignature returns sync interval signature from Redis
func (r *Redis) GetSignature(sourceID, collection, interval string) (string, error) {
	key := "source#" + sourceID + ":collection#" + collection + ":chunks"
	field := interval
	connection := r.pool.Get()
	defer connection.Close()
	signature, err := redis.String(connection.Do("HGET", key, field))
	if err != nil {
		if err == redis.ErrNil {
			return "", nil
		}

		r.errorMetrics.NoticeError(err)
		return "", err
	}

	return signature, nil
}

// SaveSignature saves sync interval signature in Redis
func (r *Redis) SaveSignature(sourceID, collection, interval, signature string) error {
	key := "source#" + sourceID + ":collection#" + collection + ":chunks"
	field := interval
	connection := r.pool.Get()
	defer connection.Close()

	_, err := connection.Do("HSET", key, field, signature)
	if err != nil && err != redis.ErrNil {
		r.errorMetrics.NoticeError(err)
		return err
	}

	return nil
}

// DeleteSignature deletes source collection signature from Redis
func (r *Redis) DeleteSignature(sourceID, collection string) error {
	key := "source#" + sourceID + ":collection#" + collection + ":chunks"
	connection := r.pool.Get()
	defer connection.Close()

	_, err := connection.Do("DEL", key)
	if err != nil && err != redis.ErrNil {
		r.errorMetrics.NoticeError(err)
		return err
	}

	return nil
}

// IncrementEventsCount increment events counter
// namespaces: [destination, source]
// eventType: [push, pull]
// status: [success, error, skip]
func (r *Redis) IncrementEventsCount(id, namespace, eventType, status string, now time.Time, value int64) error {
	conn := r.pool.Get()
	defer conn.Close()

	if err := r.ensureIDInIndex(conn, id, namespace); err != nil {
		return fmt.Errorf("Error ensuring id in index: %v", err)
	}

	//increment hourly events
	dayKey := now.Format(timestamp.DayLayout)

	hourlyEventsKey := getHourlyEventsKey(id, namespace, eventType, dayKey, status)
	fieldHour := strconv.Itoa(now.Hour())
	_, err := conn.Do("HINCRBY", hourlyEventsKey, fieldHour, value)
	if err != nil && err != redis.ErrNil {
		r.errorMetrics.NoticeError(err)
		return err
	}

	//increment daily events
	monthKey := now.Format(timestamp.MonthLayout)
	dailyEventsKey := getDailyEventsKey(id, namespace, eventType, monthKey, status)
	fieldDay := strconv.Itoa(now.Day())
	_, err = conn.Do("HINCRBY", dailyEventsKey, fieldDay, value)
	if err != nil && err != redis.ErrNil {
		r.errorMetrics.NoticeError(err)
		return err
	}

	return nil
}

// AddEvent saves event JSON string into Redis
func (r *Redis) AddEvent(namespace, id, status string, entity *Event) error {
	serialized, err := json.Marshal(entity)
	if err != nil {
		return fmt.Errorf("failed to serialize event entity [%v]: %v", entity, err)
	}

	conn := r.pool.Get()
	defer conn.Close()

	eventsKey := getCachedEventsKey(namespace, id, status)
	_, err = conn.Do("LPUSH", eventsKey, serialized)
	if err != nil && err != redis.ErrNil {
		r.errorMetrics.NoticeError(err)
		return err
	}

	return nil
}

// TrimEvents keeps only last capacity events in Redis list key with trim function
func (r *Redis) TrimEvents(namespace, id, status string, capacity int) error {
	conn := r.pool.Get()
	defer conn.Close()

	eventsKey := getCachedEventsKey(namespace, id, status)
	_, err := conn.Do("LTRIM", eventsKey, 0, capacity-1)
	if err != nil && err != redis.ErrNil {
		r.errorMetrics.NoticeError(err)
		return err
	}

	return nil
}

// GetEvents returns last n events from namespace with id
func (r *Redis) GetEvents(namespace, id, status string, limit int) ([]Event, error) {
	conn := r.pool.Get()
	defer conn.Close()

	eventsKey := getCachedEventsKey(namespace, id, status)
	eventsArr, err := redis.Strings(conn.Do("LRANGE", eventsKey, 0, limit-1))
	if err != nil && err != redis.ErrNil {
		r.errorMetrics.NoticeError(err)
		return nil, err
	}

	events := make([]Event, 0, len(eventsArr))
	for _, redisEvent := range eventsArr {
		eventObj := Event{}
		if err := json.Unmarshal([]byte(redisEvent), &eventObj); err != nil {
			return nil, fmt.Errorf("failed to deserialize event from list key: %s [%v]: %v", eventsKey, redisEvent, err)
		}

		events = append(events, eventObj)
	}

	return events, nil
}

// GetTotalEvents returns total of cached events
func (r *Redis) GetTotalEvents(namespace, id, status string) (int, error) {
	conn := r.pool.Get()
	defer conn.Close()

	eventsKey := getCachedEventsKey(namespace, id, status)
	count, err := redis.Int(conn.Do("LLEN", eventsKey))
	if err != nil && err != redis.ErrNil {
		r.errorMetrics.NoticeError(err)
		return 0, err
	}

	return count, nil
}

// CreateTask saves task into Redis and add Task ID in index
func (r *Redis) CreateTask(sourceID, collection string, task *Task, createdAt time.Time) error {
	err := r.upsertTask(task)
	if err != nil {
		return err
	}

	conn := r.pool.Get()
	defer conn.Close()

	//enrich index
	taskIndexKey := "sync_tasks_index:source#" + sourceID + ":collection#" + collection
	_, err = conn.Do("ZADD", taskIndexKey, createdAt.Unix(), task.ID)
	if err != nil && err != redis.ErrNil {
		r.errorMetrics.NoticeError(err)
		logging.SystemErrorf("Task [%s] was saved but failed to save in index: %v", task.ID, err)
		return err
	}

	return nil
}

// upsertTask overwrite task in Redis (save or update)
func (r *Redis) upsertTask(task *Task) error {
	conn := r.pool.Get()
	defer conn.Close()

	//save task
	taskKey := syncTasksPrefix + task.ID
	_, err := conn.Do("HMSET", redis.Args{taskKey}.AddFlat(task)...)
	if err != nil && err != redis.ErrNil {
		r.errorMetrics.NoticeError(err)
		return err
	}

	return nil
}

// GetAllTaskIDs returns all source's tasks ids by collection
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
	if err != nil && err != redis.ErrNil {
		r.errorMetrics.NoticeError(err)
		return nil, err
	}
	return taskIDs, nil
}

// RemoveTasks tasks with provided taskIds from specified source's collections.
// All task logs removed as well
func (r *Redis) RemoveTasks(sourceID, collection string, taskIDs ...string) (int, error) {
	conn := r.pool.Get()
	defer conn.Close()

	taskIndexKey := "sync_tasks_index:source#" + sourceID + ":collection#" + collection
	args := []interface{}{taskIndexKey} //need interface{} type to conform conn.Do method variadic signature bellow
	for _, id := range taskIDs {
		args = append(args, id)
	}

	removed, err := redis.Int(conn.Do("ZREM", args...))
	if err != nil && err != redis.ErrNil {
		r.errorMetrics.NoticeError(err)
		return 0, err
	}
	logging.Debugf("Removed %d of %d from index %s", removed, len(taskIDs), taskIndexKey)

	taskKeys := make([]interface{}, 0, len(taskIDs))
	for _, id := range taskIDs {
		taskKeys = append(taskKeys, syncTasksPrefix+id)
	}

	removed, err = redis.Int(conn.Do("DEL", taskKeys...))
	if err != nil && err != redis.ErrNil {
		r.errorMetrics.NoticeError(err)
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
	if err != nil && err != redis.ErrNil {
		r.errorMetrics.NoticeError(err)
		//no point to return error. we have already cleared index
		logging.Errorf("failed to remove task logs. source:%s collection:%s tasks:%v err:%v", sourceID, collection, taskIDs, err)
	} else {
		logging.Debugf("Removed logs from %d of %d tasks. source:%s collection:%s", removed, len(taskIDs), sourceID, collection)
	}
	return removed, nil
}

// UpdateStartedTask updates only status and started_at field in the task
func (r *Redis) UpdateStartedTask(taskID, status string) error {
	conn := r.pool.Get()
	defer conn.Close()

	_, err := conn.Do("HSET", syncTasksPrefix+taskID, "status", status, "started_at", timestamp.NowUTC())
	if err != nil && err != redis.ErrNil {
		r.errorMetrics.NoticeError(err)
		return err
	}

	return nil
}

// UpdateFinishedTask updates only status and finished_at field in the task
func (r *Redis) UpdateFinishedTask(taskID, status string) error {
	conn := r.pool.Get()
	defer conn.Close()

	_, err := conn.Do("HSET", syncTasksPrefix+taskID, "status", status, "finished_at", timestamp.NowUTC())
	if err != nil && err != redis.ErrNil {
		r.errorMetrics.NoticeError(err)
		return err
	}

	return nil
}

// TaskHeartBeat sets current timestamp into heartbeat key
func (r *Redis) TaskHeartBeat(taskID string) error {
	conn := r.pool.Get()
	defer conn.Close()

	_, err := conn.Do("HSET", taskHeartBeatKey, taskID, timestamp.NowUTC())
	if err != nil && err != redis.ErrNil {
		r.errorMetrics.NoticeError(err)
		return err
	}

	return nil
}

// RemoveTaskFromHeartBeat removes taskID current timestamp from heartbeat key
func (r *Redis) RemoveTaskFromHeartBeat(taskID string) error {
	conn := r.pool.Get()
	defer conn.Close()

	_, err := conn.Do("HDEL", taskHeartBeatKey, taskID)
	if err != nil && err != redis.ErrNil {
		r.errorMetrics.NoticeError(err)
		return err
	}

	return nil
}

// GetAllTasksHeartBeat returns map with taskID-last heartbeat timestamp pairs
func (r *Redis) GetAllTasksHeartBeat() (map[string]string, error) {
	conn := r.pool.Get()
	defer conn.Close()

	tasksHeartBeat, err := redis.StringMap(conn.Do("HGETALL", taskHeartBeatKey))
	if err != nil {
		if err == redis.ErrNil {
			return map[string]string{}, nil
		}

		r.errorMetrics.NoticeError(err)

		return nil, err
	}

	return tasksHeartBeat, nil
}

// GetAllTasksForInitialHeartbeat returns all task IDs where:
// 1. task is RUNNING and last log time more than last activity threshold
// 2. task is SCHEDULED and task creation time more than last activity threshold
func (r *Redis) GetAllTasksForInitialHeartbeat(runningStatus, scheduledStatus string, lastActivityThreshold time.Duration) ([]string, error) {
	conn := r.pool.Get()
	defer conn.Close()

	//the task is stalled if last activity was before current time - lastActivityThreshold
	stalledTime := timestamp.Now().UTC().Truncate(lastActivityThreshold)

	var taskIDs []string
	cursor := 0

	for {
		scannedResult, err := redis.Values(conn.Do("SCAN", cursor, "MATCH", syncTasksPrefix+"*", "TYPE", "hash", "COUNT", 50000))
		if err != nil {
			if err != nil && err != redis.ErrNil {
				r.errorMetrics.NoticeError(err)
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

// filterStalledTaskInRunningStatus gets last logs and compares with stalledTime. If there is no logs, compare task creation time
// returns true if task is stalled
func (r *Redis) filterStalledTaskInRunningStatus(conn redis.Conn, task *Task, stalledTime time.Time) (bool, error) {
	lastLogArr, err := redis.Values(conn.Do("ZREVRANGEBYSCORE", syncTasksPrefix+task.ID+":logs", timestamp.Now().Unix(), 0, "LIMIT", 0, 1, "WITHSCORES"))
	if err != nil {
		if err != nil && err != redis.ErrNil {
			r.errorMetrics.NoticeError(err)
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

// filterStalledTaskInScheduledStatus gets task creation time and compares with stalledTime
// returns true if task is stalled
func (r *Redis) filterStalledTaskInScheduledStatus(task *Task, stalledTime time.Time) (bool, error) {
	createdAt, err := time.Parse(time.RFC3339Nano, task.CreatedAt)
	if err != nil {
		return false, fmt.Errorf("error parsing created_at [%s] of task [%s] as time: %v", task.StartedAt, task.ID, err)
	}

	return createdAt.Before(stalledTime), nil
}

// GetAllTasks returns all source's tasks by collection and time criteria
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
	if err != nil && err != redis.ErrNil {
		r.errorMetrics.NoticeError(err)
		return nil, err
	}

	var tasks []Task
	for _, taskID := range taskIDs {
		//get certain task
		taskKey := syncTasksPrefix + taskID
		task, err := redis.Values(conn.Do("HGETALL", taskKey))
		if err != nil && err != redis.ErrNil {
			r.errorMetrics.NoticeError(err)
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

// GetLastTask returns last sync task
func (r *Redis) GetLastTask(sourceID, collection string, offset int) (*Task, error) {
	conn := r.pool.Get()
	defer conn.Close()

	taskIndexKey := "sync_tasks_index:source#" + sourceID + ":collection#" + collection
	limitStart := fmt.Sprintf("%d", offset)
	limitEnd := fmt.Sprintf("%d", offset+1)
	taskValues, err := redis.Strings(conn.Do("ZREVRANGEBYSCORE", taskIndexKey, "+inf", "-inf", "LIMIT", limitStart, limitEnd))
	if err != nil && err != redis.ErrNil {
		r.errorMetrics.NoticeError(err)
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

// GetTask opens connection and returns result of getTask
func (r *Redis) GetTask(taskID string) (*Task, error) {
	conn := r.pool.Get()
	defer conn.Close()

	return r.getTask(conn, taskID)
}

// getTask returns task by task ID or ErrTaskNotFound
func (r *Redis) getTask(conn redis.Conn, taskID string) (*Task, error) {
	taskFields, err := redis.Values(conn.Do("HGETALL", syncTasksPrefix+taskID))
	if err != nil {
		if err == redis.ErrNil {
			return nil, ErrTaskNotFound
		}

		r.errorMetrics.NoticeError(err)

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

// AppendTaskLog appends log record into task logs sorted set
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
	if err != nil && err != redis.ErrNil {
		r.errorMetrics.NoticeError(err)
		return err
	}

	return nil
}

// GetTaskLogs returns task logs with time criteria
func (r *Redis) GetTaskLogs(taskID string, start, end time.Time) ([]TaskLogRecord, error) {
	conn := r.pool.Get()
	defer conn.Close()

	taskLogsKey := syncTasksPrefix + taskID + ":logs"
	logsRecords, err := redis.Strings(conn.Do("ZRANGEBYSCORE", taskLogsKey, start.Unix(), end.Unix()))
	if err != nil && err != redis.ErrNil {
		r.errorMetrics.NoticeError(err)
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

// PollTask return task from the Queue or nil if the queue is empty
func (r *Redis) PollTask() (*Task, error) {
	conn := r.pool.Get()
	defer conn.Close()

	values, err := redis.Strings(conn.Do("ZPOPMAX", syncTasksPriorityQueueKey))
	if err != nil {
		if err == redis.ErrNil {
			return nil, nil
		}

		r.errorMetrics.NoticeError(err)
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

// PushTask saves task into priority queue
func (r *Redis) PushTask(task *Task) error {
	conn := r.pool.Get()
	defer conn.Close()

	_, err := conn.Do("ZADD", syncTasksPriorityQueueKey, task.Priority, task.ID)
	if err != nil {
		if err == redis.ErrNil {
			return nil
		}

		r.errorMetrics.NoticeError(err)
		return err
	}

	return nil
}

// GetProjectSourceIDs returns project's sources ids
func (r *Redis) GetProjectSourceIDs(projectID string) ([]string, error) {
	return r.getProjectIDs(projectID, sourceIndex)
}

// GetProjectPushSourceIDs returns project's pushed sources ids (api keys)
func (r *Redis) GetProjectPushSourceIDs(projectID string) ([]string, error) {
	return r.getProjectIDs(projectID, pushSourceIndex)
}

// GetProjectDestinationIDs returns project's destination ids
func (r *Redis) GetProjectDestinationIDs(projectID string) ([]string, error) {
	return r.getProjectIDs(projectID, destinationIndex)
}

// GetEventsWithGranularity returns events amount with time criteria by granularity, status and sources/destination ids
func (r *Redis) GetEventsWithGranularity(namespace, status, eventType string, ids []string, start, end time.Time, granularity Granularity) ([]EventsPerTime, error) {
	conn := r.pool.Get()
	defer conn.Close()

	if granularity == HOUR {
		return r.getEventsPerHour(conn, namespace, eventType, status, ids, start, end)
	} else if granularity == DAY {
		return r.getEventsPerDay(conn, namespace, eventType, status, ids, start, end)
	}

	return nil, fmt.Errorf("Unknown granularity: %s", granularity.String())
}

// getEventsPerHour returns sum of sources/destinations events per hour (between start and end)
// namespace: [destination, source]
// status: [success, error, skip]
// identifiers: sources/destinations ids
func (r *Redis) getEventsPerHour(conn redis.Conn, namespace, eventType, status string, identifiers []string, start, end time.Time) ([]EventsPerTime, error) {
	eventsPerChunk := map[string]int{} //key = 2021-03-17T00:00:00+0000 | value = events count

	days := getCoveredDays(start, end)

	for _, day := range days {
		keyTime, _ := time.Parse(timestamp.DayLayout, day)

		for _, id := range identifiers {
			key := getHourlyEventsKey(id, namespace, eventType, day, status)

			perHour, err := redis.IntMap(conn.Do("HGETALL", key))
			if err != nil {
				if err == redis.ErrNil {
					continue
				}

				r.errorMetrics.NoticeError(err)
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

// getEventsPerHour returns sum of sources/destinations events per day (between start and end)
// namespace: [destination, source]
// status: [success, error, skip]
func (r *Redis) getEventsPerDay(conn redis.Conn, namespace, eventType, status string, identifiers []string, start, end time.Time) ([]EventsPerTime, error) {
	eventsPerChunk := map[string]int{} //key = 2021-03-17T00:00:00+0000 | value = events count

	months := getCoveredMonths(start, end)

	for _, month := range months {
		keyTime, _ := time.Parse(timestamp.MonthLayout, month)

		for _, id := range identifiers {
			key := getDailyEventsKey(id, namespace, eventType, month, status)

			perDay, err := redis.IntMap(conn.Do("HGETALL", key))
			if err != nil {
				if err == redis.ErrNil {
					continue
				}

				r.errorMetrics.NoticeError(err)
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

// GetOrCreateClusterID returns clusterID from Redis or save input one
func (r *Redis) GetOrCreateClusterID(generatedClusterID string) string {
	key := ConfigPrefix + SystemKey
	field := "cluster_id"

	conn := r.pool.Get()
	defer conn.Close()

	clusterID, err := redis.String(conn.Do("HGET", key, field))
	if err != nil {
		if err != redis.ErrNil {
			r.errorMetrics.NoticeError(err)
			return "err"
		}
	}

	if clusterID != "" {
		return clusterID
	}

	//save and return generated
	_, err = conn.Do("HSET", key, field, generatedClusterID)
	if err != nil {
		if err != redis.ErrNil {
			r.errorMetrics.NoticeError(err)
			return "err"
		}
	}

	return generatedClusterID
}

func (r *Redis) Type() string {
	return RedisType
}

func (r *Redis) Close() error {
	return r.pool.Close()
}

// getProjectIDs returns project's entities with indexName
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

		r.errorMetrics.NoticeError(err)
		return nil, err
	}

	return IDs, nil
}

// ensureIDInIndex add id to corresponding index by projectID
// namespaces: [destination, source]
func (r *Redis) ensureIDInIndex(conn redis.Conn, id, namespace string) error {
	var indexName string
	switch namespace {
	case DestinationNamespace:
		indexName = destinationIndex
	case SourceNamespace:
		indexName = sourceIndex
	//536-issue DEPRECATED
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
	if err != nil && err != redis.ErrNil {
		r.errorMetrics.NoticeError(err)
		return err
	}

	return nil
}

// getCoveredDays return array of YYYYMMDD day strings which are covered input interval
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

// getCoveredMonths return array of YYYYMM month strings which are covered input interval
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

func getCachedEventsKey(namespace, id, status string) string {
	var statusPart string
	if status != "" {
		statusPart = ":" + status
	}
	return fmt.Sprintf("events_cache:%s#%s%s", namespace, id, statusPart)
}

func getHourlyEventsKey(id, namespace, eventType, day, status string) string {
	return getEventsCounterKey("hourly_events", id, namespace, eventType, "day#"+day, status)
}

func getDailyEventsKey(id, namespace, eventType, month, status string) string {
	return getEventsCounterKey("daily_events", id, namespace, eventType, "month#"+month, status)
}

func getEventsCounterKey(prefix, id, namespace, eventType, timeKey, status string) string {
	//536-issue DEPRECATED
	//backward compatibility
	if eventType != "" {
		eventType = ":type#" + eventType
	}

	return fmt.Sprintf("%s:%s#%s%s:%s:%s", prefix, namespace, id, eventType, timeKey, status)
}
