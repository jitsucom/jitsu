package synchronization

import (
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/server/appconfig"
	"time"

	"github.com/jitsucom/jitsu/server/coordination"
	"github.com/jitsucom/jitsu/server/destinations"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	"github.com/jitsucom/jitsu/server/safego"
	"github.com/jitsucom/jitsu/server/schema"
	"github.com/jitsucom/jitsu/server/sources"
	"github.com/jitsucom/jitsu/server/timestamp"
	uuid "github.com/satori/go.uuid"
)

var (
	ErrSourceCollectionIsSyncing        = errors.New("Source collection is syncing now")
	ErrSourceCollectionIsStartingToSync = errors.New("Source collection is starting to sync")
	ErrMetaStorageRequired              = errors.New("meta.storage configuration is required for sources synchronization tasks features")
)

//TaskDto is used in Task API (handlers.TaskHandler)
type TaskDto struct {
	ID         string `json:"id,omitempty"`
	SourceType string `json:"source_type,omitempty"`
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
	System  string `json:"system,omitempty"`
}

//TaskService handle get all tasks/ task logs requests
type TaskService struct {
	sourceService       *sources.Service
	destinationService  *destinations.Service
	metaStorage         meta.Storage
	coordinationService *coordination.Service

	storeTasksLogsForLastRuns int
	configured                bool
}

//NewTestTaskService returns TaskService test instance (only for tests)
func NewTestTaskService() *TaskService {
	return &TaskService{}
}

//NewTaskService returns configured TaskService instance
func NewTaskService(sourceService *sources.Service, destinationService *destinations.Service,
	metaStorage meta.Storage, coordinationService *coordination.Service, storeTasksLogsForLastRuns int) *TaskService {
	if !sourceService.IsConfigured() {
		return &TaskService{}
	}

	if storeTasksLogsForLastRuns > 0 {
		logging.Infof("[Sync Task Service] with last task limit: %d", storeTasksLogsForLastRuns)
	}

	return &TaskService{sourceService: sourceService, destinationService: destinationService, metaStorage: metaStorage,
		coordinationService: coordinationService, configured: true, storeTasksLogsForLastRuns: storeTasksLogsForLastRuns}
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

//Sync creates task and return its ID
//returns error if task has been already scheduled or has been already in progress (lock in coordination service)
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
	taskCreationLock := ts.coordinationService.CreateLock(sourceID + "_" + collection + "_task_creation")
	locked, err := taskCreationLock.TryLock(0)
	if err != nil {
		return "", fmt.Errorf("failed to get task creation lock source [%s] collection %s: %v", sourceID, collection, err)
	}
	if !locked {
		return "", ErrSourceCollectionIsStartingToSync
	}
	defer taskCreationLock.Unlock()

	//get and check last task - if it has already been created
	lastTask, getTaskErr := ts.metaStorage.GetLastTask(sourceID, collection, 0)
	if getTaskErr != nil {
		if getTaskErr != meta.ErrTaskNotFound {
			return "", fmt.Errorf("Unable to get last task: %v", getTaskErr)
		}
	}

	if lastTask != nil && (lastTask.Status == SCHEDULED.String() || lastTask.Status == RUNNING.String()) {
		return lastTask.ID, ErrSourceCollectionIsSyncing
	}

	sourceUnit, err := ts.sourceService.GetSource(sourceID)
	if err != nil {
		return "", err
	}

	//check if collection exists
	_, ok := sourceUnit.DriverPerCollection[collection]
	if !ok {
		return "", fmt.Errorf("Collection with id [%s] wasn't found in source [%s]", collection, sourceID)
	}

	//check if destinations are set
	if len(sourceUnit.DestinationIDs) == 0 {
		return "", fmt.Errorf("Destinations can't be empty. Please configure at least one destination")
	}

	//make sure all destinations exist and ready
	for _, destinationID := range sourceUnit.DestinationIDs {
		storageProxy, ok := ts.destinationService.GetDestinationByID(destinationID)
		if !ok {
			return "", fmt.Errorf("Destination [%s] doesn't exist", destinationID)
		}

		_, ok = storageProxy.Get()
		if !ok {
			return "", fmt.Errorf("Destination [%s] isn't initialized", destinationID)
		}
	}

	generatedTaskID := schema.Reformat(fmt.Sprintf("%s_%s_%s", sourceID, collection, uuid.NewV4().String()))

	now := timestamp.Now().UTC()
	task := meta.Task{
		ID:         generatedTaskID,
		SourceType: sourceUnit.SourceType,
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
	safego.Run(func() { ts.cleanup(sourceID, collection, task.ID) })
	return task.ID, nil
}

//cleanup removes data and logs for old tasks if its number exceed limit set via storeTasksLogsForLastRuns
func (ts *TaskService) cleanup(sourceID, collection, taskId string) {
	if ts.storeTasksLogsForLastRuns <= 0 {
		return
	}

	taskIds, err := ts.metaStorage.GetAllTaskIDs(sourceID, collection, true)
	if err != nil {
		logging.Errorf("task %s failed to get task IDs to perform cleanup: %v", taskId, err)
		return
	}

	if len(taskIds) > ts.storeTasksLogsForLastRuns {
		logging.Infof("task %s cleanup: need to keep %v of total %v", taskId, ts.storeTasksLogsForLastRuns, len(taskIds))
		taskIdsToDelete := taskIds[ts.storeTasksLogsForLastRuns:]
		removed, err := ts.metaStorage.RemoveTasks(sourceID, collection, taskIdsToDelete...)
		if err != nil {
			logging.Errorf("task %s failed to remove tasks while cleanup: %v", taskId, err)
		}
		logging.Infof("task %s cleanup: removed %v of total %v", taskId, removed, len(taskIds))
	} else {
		logging.Infof("task %s cleanup: no need. current size: %v. limit: %v", taskId, len(taskIds), ts.storeTasksLogsForLastRuns)
	}
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
		SourceType: task.SourceType,
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
			SourceType: task.SourceType,
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
			System:  lr.System,
		})
	}

	return result, nil
}

//CancelTask saves CANCEL status into the task in Redis
func (ts *TaskService) CancelTask(taskID string) error {
	if ts.metaStorage == nil {
		return ErrMetaStorageRequired
	}

	if err := ts.metaStorage.UpdateFinishedTask(taskID, CANCELED.String()); err != nil {
		return fmt.Errorf("error changing task [%s] status to [%s]: %v", taskID, CANCELED.String(), err)
	}

	taskLogger := NewTaskLogger(taskID, ts.metaStorage, appconfig.Instance.SourcesLogsWriter)
	taskLogger.WARN(ErrTaskHasBeenCanceled.Error())

	return nil
}

func (ts *TaskService) IsConfigured() bool {
	return ts.configured
}
