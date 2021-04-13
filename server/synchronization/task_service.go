package synchronization

import (
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/server/coordination"
	"github.com/jitsucom/jitsu/server/destinations"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	"github.com/jitsucom/jitsu/server/sources"
	"github.com/jitsucom/jitsu/server/storages"
	"github.com/jitsucom/jitsu/server/timestamp"
	uuid "github.com/satori/go.uuid"
	"time"
)

var (
	ErrSourceCollectionIsSyncing        = errors.New("Source collection is syncing now")
	ErrSourceCollectionIsStartingToSync = errors.New("Source collection is starting to sync")
	ErrMetaStorageRequired              = errors.New("meta.storage configuration is required for sources synchronization tasks features")
)

//TaskDto is used in Task API (handlers.TaskHandler)
type TaskDto struct {
	ID         string `json:"id,omitempty"`
	Source     string `json:"source,omitempty"`
	Collection string `json:"collection,omitempty"`
	Priority   int64  `json:"priority,omitempty"`
	CreatedAt  string `json:"created_at,omitempty"`
	StartedAt  string `json:"started_at,omitempty"`
	FinishedAt string `json:"finished_at,omitempty"`
	Status     string `json:"status,omitempty"`
}

//LogRecordDto is used in Task API (handlers.TaskHandler)
type LogRecordDto struct {
	Time    string `json:"time,omitempty"`
	Message string `json:"message,omitempty"`
	Level   string `json:"level,omitempty"`
}

//TaskService handle get all tasks/ task logs requests
type TaskService struct {
	sourceService      *sources.Service
	destinationService *destinations.Service
	metaStorage        meta.Storage
	monitorKeeper      storages.MonitorKeeper

	configured bool
}

//only for tests
func NewTestTaskService() *TaskService {
	return &TaskService{}
}

func NewTaskService(sourceService *sources.Service, destinationService *destinations.Service,
	metaStorage meta.Storage, monitorKeeper storages.MonitorKeeper) *TaskService {
	if !sourceService.IsConfigured() {
		return &TaskService{}
	}

	return &TaskService{sourceService: sourceService, destinationService: destinationService, metaStorage: metaStorage,
		monitorKeeper: monitorKeeper, configured: true}
}

//ScheduleSyncFunc is used in scheduling.CronScheduler for scheduling sync of source&collection with retry
//and for avoiding dependency cycle
func (ts *TaskService) ScheduleSyncFunc(source, collection string, retryCount int) {
	var retryLog string
	if retryCount > 0 {
		retryLog = fmt.Sprintf("(retried %d attempts)", retryCount)
	}
	logging.Infof("[%s_%s] Schedule sync %s..", source, collection, retryLog)

	taskID, err := ts.Sync(source, collection, HIGH)
	if err != nil {
		if err == ErrSourceCollectionIsStartingToSync {
			logging.Warnf("[%s_%s] Sync is being already started by another initiator", source, collection)
			return
		}

		if err == ErrSourceCollectionIsSyncing {
			logging.Warnf("[%s_%s] Sync is being already executed! task id: %s", source, collection, taskID)
			return
		}

		if retryCount < 2 {
			retryCount++

			logging.Errorf("[%s_%s] Error scheduling sync, but will be retried after %d minutes: %v", source, collection, retryCount, err)

			time.Sleep(time.Minute * time.Duration(retryCount))
			ts.ScheduleSyncFunc(source, collection, retryCount)
			return
		}

		logging.Errorf("[%s_%s] Error scheduling sync: %v", source, collection, err)
		return
	}

	logging.Infof("[%s_%s] sync has been scheduled! task id: %s", source, collection, taskID)
}

//Sync create task and return its ID
//return error if task has been already scheduled or has been already in progress (lock in coordination service)
func (ts *TaskService) Sync(sourceID, collection string, priority Priority) (string, error) {
	if ts.metaStorage == nil {
		return "", ErrMetaStorageRequired
	}

	//check source exists
	_, err := ts.sourceService.GetSource(sourceID)
	if err != nil {
		return "", err
	}

	//get task-creation lock
	creationTaskLock, err := ts.monitorKeeper.TryLock(sourceID, collection+"task_creation")
	if err != nil {
		if err == coordination.ErrAlreadyLocked {
			return "", ErrSourceCollectionIsStartingToSync
		}

		return "", err
	}
	defer ts.monitorKeeper.Unlock(creationTaskLock)

	locked, err := ts.monitorKeeper.IsLocked(sourceID, collection)
	if err != nil {
		return "", err
	}

	if locked {
		//get last task
		task, getTaskErr := ts.metaStorage.GetLastTask(sourceID, collection)
		if getTaskErr != nil {
			return "", fmt.Errorf("Collection sync task is in progress (unable to get last task: %v)", getTaskErr)
		}

		if task.Status == RUNNING.String() {
			return task.ID, ErrSourceCollectionIsSyncing
		}

		logging.SystemErrorf("Error sync source [%s] collection [%s]: locked and last task has wrong status: %s", sourceID, collection, task.Status)
		return "", fmt.Errorf("Collection sync task is in progress (last task has wrong status: %s)", task.Status)
	}

	//check if in the queue
	taskID, ok, err := ts.metaStorage.IsTaskInQueue(sourceID, collection)
	if err != nil {
		return "", fmt.Errorf("Unable to check if task is in the queue: %v", err)
	}
	if ok {
		return taskID, ErrSourceCollectionIsSyncing
	}

	sourceUnit, err := ts.sourceService.GetSource(sourceID)
	if err != nil {
		return "", err
	}

	//check if collection exists
	_, ok = sourceUnit.DriverPerCollection[collection]
	if !ok {
		return "", fmt.Errorf("Collection with id [%s] wasn't found in source [%s]", collection, sourceID)
	}

	//make sure all destinations exist and ready
	for _, destinationID := range sourceUnit.DestinationIDs {
		storageProxy, ok := ts.destinationService.GetStorageByID(destinationID)
		if !ok {
			return "", fmt.Errorf("Destination [%s] doesn't exist", destinationID)
		}

		_, ok = storageProxy.Get()
		if !ok {
			return "", fmt.Errorf("Destination [%s] isn't initialized", destinationID)
		}
	}

	now := time.Now().UTC()
	task := meta.Task{
		ID:         fmt.Sprintf("%s_%s_%s", sourceID, collection, uuid.NewV4().String()),
		Source:     sourceID,
		Collection: collection,
		Priority:   priority.GetValue(now),
		CreatedAt:  now.Format(timestamp.Layout),
		StartedAt:  "",
		FinishedAt: "",
		Status:     SCHEDULED.String(),
	}

	err = ts.metaStorage.CreateTask(sourceID, collection, &task, now)
	if err != nil {
		return "", fmt.Errorf("Error saving sync task: %v", err)
	}

	err = ts.metaStorage.PushTask(&task)
	if err != nil {
		return "", fmt.Errorf("Error pushing sync task to the Queue: %v", err)
	}

	return task.ID, nil
}

//GetTask return task by id
func (ts *TaskService) GetTask(id string) (*TaskDto, error) {
	if ts.metaStorage == nil {
		return nil, ErrMetaStorageRequired
	}

	task, err := ts.metaStorage.GetTask(id)
	if err != nil {
		return nil, fmt.Errorf("Error getting task by id [%s] from storage: %v", id, err)
	}

	return &TaskDto{
		ID:         task.ID,
		Source:     task.Source,
		Collection: task.Collection,
		Priority:   task.Priority,
		CreatedAt:  task.CreatedAt,
		StartedAt:  task.StartedAt,
		FinishedAt: task.FinishedAt,
		Status:     task.Status,
	}, nil
}

//GetTasks return all tasks with input filters
func (ts *TaskService) GetTasks(sourceID, collectionID string, statusFilter *Status, start, end time.Time, limit int) ([]TaskDto, error) {
	if ts.metaStorage == nil {
		return nil, ErrMetaStorageRequired
	}

	tasks, err := ts.metaStorage.GetAllTasks(sourceID, collectionID, start, end, limit)
	if err != nil {
		return nil, err
	}

	if len(tasks) == 0 {
		return []TaskDto{}, nil
	}

	var result []TaskDto
	for _, task := range tasks {
		if statusFilter != nil && task.Status != statusFilter.String() {
			continue
		}

		result = append(result, TaskDto{
			ID:         task.ID,
			Source:     task.Source,
			Collection: task.Collection,
			Priority:   task.Priority,
			CreatedAt:  task.CreatedAt,
			StartedAt:  task.StartedAt,
			FinishedAt: task.FinishedAt,
			Status:     task.Status,
		})
	}

	return result, nil
}

//GetTaskLogs return task logs with input filters
func (ts *TaskService) GetTaskLogs(taskID string, start, end time.Time) ([]LogRecordDto, error) {
	if ts.metaStorage == nil {
		return nil, ErrMetaStorageRequired
	}

	logRecords, err := ts.metaStorage.GetTaskLogs(taskID, start, end)
	if err != nil {
		return nil, err
	}

	if len(logRecords) == 0 {
		return []LogRecordDto{}, nil
	}

	var result []LogRecordDto
	for _, lr := range logRecords {
		result = append(result, LogRecordDto{
			Time:    lr.Time,
			Message: lr.Message,
			Level:   lr.Level,
		})
	}

	return result, nil
}

func (ts *TaskService) IsConfigured() bool {
	return ts.configured
}
