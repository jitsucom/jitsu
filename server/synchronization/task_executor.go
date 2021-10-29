package synchronization

import (
	"encoding/json"
	"fmt"
	"github.com/jitsucom/jitsu/server/counters"
	"github.com/jitsucom/jitsu/server/destinations"
	driversbase "github.com/jitsucom/jitsu/server/drivers/base"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	"github.com/jitsucom/jitsu/server/metrics"
	"github.com/jitsucom/jitsu/server/safego"
	"github.com/jitsucom/jitsu/server/schema"
	"github.com/jitsucom/jitsu/server/sources"
	"github.com/jitsucom/jitsu/server/storages"
	"github.com/jitsucom/jitsu/server/telemetry"
	"github.com/jitsucom/jitsu/server/timestamp"
	"github.com/jitsucom/jitsu/server/uuid"
	"github.com/panjf2000/ants/v2"
	"time"
)

const srcSource = "source"

type TaskExecutor struct {
	workersPool        *ants.PoolWithFunc
	sourceService      *sources.Service
	destinationService *destinations.Service
	metaStorage        meta.Storage
	monitorKeeper      storages.MonitorKeeper

	closed bool
}

//NewTaskExecutor returns TaskExecutor and starts 2 goroutines (monitoring and queue observer)
func NewTaskExecutor(poolSize int, sourceService *sources.Service, destinationService *destinations.Service, metaStorage meta.Storage, monitorKeeper storages.MonitorKeeper) (*TaskExecutor, error) {
	executor := &TaskExecutor{sourceService: sourceService, destinationService: destinationService, metaStorage: metaStorage, monitorKeeper: monitorKeeper}
	pool, err := ants.NewPoolWithFunc(poolSize, executor.execute)
	if err != nil {
		return nil, fmt.Errorf("Error creating goroutines pool: %v", err)
	}

	executor.workersPool = pool
	executor.startMonitoring()
	executor.startObserver()

	return executor, nil
}

//startMonitoring run goroutine for setting pool size metrics every 20 seconds
func (te *TaskExecutor) startMonitoring() {
	safego.RunWithRestart(func() {
		for {
			if te.closed {
				break
			}

			metrics.RunningSourcesGoroutines(te.workersPool.Running())
			metrics.FreeSourcesGoroutines(te.workersPool.Free())

			time.Sleep(20 * time.Second)
		}
	})
}

//startObserver run goroutine for polling from the queue and put task to workers pool every 1 second
func (te *TaskExecutor) startObserver() {
	safego.RunWithRestart(func() {
		for {
			if te.closed {
				break
			}

			if te.workersPool.Free() > 0 {
				task, err := te.metaStorage.PollTask()
				if err != nil {
					logging.SystemErrorf("Error polling task: %v", err)
				} else if task != nil {
					if err := te.workersPool.Invoke(task); err != nil {
						logging.SystemErrorf("Error running task [%s]: %v", task.ID, err)
					}
				}
			}

			time.Sleep(time.Second)
		}
	})
}

//run validate task and execute sync (singer or plain)
func (te *TaskExecutor) execute(i interface{}) {
	task, ok := i.(*meta.Task)
	if !ok {
		taskPayload, _ := json.Marshal(i)
		logging.SystemErrorf("Meta task [%s] has unknown type: %T", string(taskPayload), i)
		return
	}

	//create redis logger
	taskLogger := NewTaskLogger(task.ID, te.metaStorage)
	logging.Infof("[%s] Running task...", task.ID)
	taskLogger.INFO("Running task...")

	taskCloser := NewTaskCloser(task, taskLogger, te.metaStorage)

	task.Status = RUNNING.String()
	task.StartedAt = timestamp.NowUTC()
	err := te.metaStorage.UpsertTask(task)
	if err != nil {
		msg := fmt.Sprintf("Error updating running task [%s] in meta.Storage: %v", task.ID, err)
		taskCloser.CloseWithError(msg, true)
		return
	}

	logging.Debugf("[TASK %s] Getting sync lock source [%s] collection [%s]...", task.ID, task.Source, task.Collection)
	collectionLock, err := te.monitorKeeper.Lock(task.Source, task.Collection)
	if err != nil {
		msg := fmt.Sprintf("Error getting lock source [%s] collection [%s] task [%s]: %v", task.Source, task.Collection, task.ID, err)
		taskCloser.CloseWithError(msg, true)
		return
	}
	logging.Debugf("[TASK %s] Lock obtained for source [%s] collection [%s]!", task.ID, task.Source, task.Collection)
	defer te.monitorKeeper.Unlock(collectionLock)

	sourceUnit, err := te.sourceService.GetSource(task.Source)
	if err != nil {
		msg := fmt.Sprintf("Error getting source in task [%s]: %v", task.ID, err)
		taskCloser.CloseWithError(msg, true)
		return
	}

	driver, ok := sourceUnit.DriverPerCollection[task.Collection]
	if !ok {
		msg := fmt.Sprintf("Collection with id [%s] wasn't found in source [%s] in task [%s]", task.Collection, task.Source, task.ID)
		taskCloser.CloseWithError(msg, true)
		return
	}
	//get destinations
	var destinationStorages []storages.Storage
	for _, destinationID := range sourceUnit.DestinationIDs {
		storageProxy, ok := te.destinationService.GetDestinationByID(destinationID)
		if ok {
			storage, ok := storageProxy.Get()
			if ok {
				destinationStorages = append(destinationStorages, storage)
			} else {
				msg := fmt.Sprintf("Unable to get destination [%s] in source [%s]: destination isn't initialized", destinationID, task.Source)
				logging.SystemError(msg)
				taskLogger.ERROR(msg)
			}
		} else {
			msg := fmt.Sprintf("Unable to get destination [%s] in source [%s]: doesn't exist", destinationID, task.Source)
			logging.SystemError(msg)
			taskLogger.ERROR(msg)
		}
	}

	if len(destinationStorages) == 0 {
		msg := fmt.Sprintf("Empty destinations. Task [%s] will be skipped", task.ID)
		taskCloser.CloseWithError(msg, false)
		return
	}

	//** Task execution **
	start := time.Now().UTC()

	var taskErr error
	cliDriver, ok := driver.(driversbase.CLIDriver)
	if ok {
		taskErr = te.syncCLI(task, taskLogger, cliDriver, destinationStorages, taskCloser)
	} else {
		taskErr = te.sync(task, taskLogger, driver, destinationStorages)
	}

	if taskErr != nil {
		taskCloser.CloseWithError(taskErr.Error(), false)
		return
	}

	end := time.Now().UTC().Sub(start)
	taskLogger.INFO("FINISHED SUCCESSFULLY in [%.2f] seconds (~ %.2f minutes)", end.Seconds(), end.Minutes())
	logging.Infof("[%s] FINISHED SUCCESSFULLY in [%.2f] seconds (~ %.2f minutes)", task.ID, end.Seconds(), end.Minutes())

	task.Status = SUCCESS.String()
	task.FinishedAt = timestamp.NowUTC()
	err = te.metaStorage.UpsertTask(task)
	if err != nil {
		msg := fmt.Sprintf("Error updating success task [%s] in meta.Storage: %v", task.ID, err)
		taskCloser.CloseWithError(msg, true)
		return
	}
	te.onSuccess(task, sourceUnit, taskLogger)
}

func (te *TaskExecutor) onSuccess(task *meta.Task, source *sources.Unit, taskLogger *TaskLogger) {
	event := events.Event{
		"event_type":  storages.SourceSuccessEventType,
		"source":      task.Source,
		"status":      task.Status,
		timestamp.Key: task.FinishedAt,
		"finished_at": task.FinishedAt,
		"started_at":  task.StartedAt,
	}
	for _, id := range source.PostHandleDestinationIDs {
		err := te.destinationService.PostHandle(id, event)
		if err != nil {
			logging.Error(err)
			taskLogger.ERROR(err.Error())
		} else {
			taskLogger.INFO("Successful run triggered postHandle destination: %s", id)
		}
	}
}

//sync runs source synchronization. Return error if occurred
//doesn't use task closer because there is no async tasks
func (te *TaskExecutor) sync(task *meta.Task, taskLogger *TaskLogger, driver driversbase.Driver,
	destinationStorages []storages.Storage) error {
	now := time.Now().UTC()

	refreshWindow, err := driver.GetRefreshWindow()
	if err != nil {
		return fmt.Errorf("Error getting refresh window: %v", err)
	}
	intervals, err := driver.GetAllAvailableIntervals()
	if err != nil {
		return fmt.Errorf("Error getting all available intervals: %v", err)
	}

	taskLogger.INFO("Total intervals: [%d] Refresh window: %s", len(intervals), refreshWindow)
	collectionMetaKey := driver.GetCollectionMetaKey()

	var intervalsToSync []*driversbase.TimeInterval
	for _, interval := range intervals {
		storedSignature, err := te.metaStorage.GetSignature(task.Source, collectionMetaKey, interval.String())
		if err != nil {
			return fmt.Errorf("Error getting interval [%s] signature: %v", interval.String(), err)
		}

		nowSignature := interval.CalculateSignatureFrom(now, refreshWindow)

		//just for logs
		var intervalLogStatus string
		if storedSignature == "" {
			intervalLogStatus = "NEW"
			intervalsToSync = append(intervalsToSync, interval)
		} else if storedSignature != nowSignature || interval.IsAll() {
			intervalLogStatus = "REFRESH"
			intervalsToSync = append(intervalsToSync, interval)
		} else {
			intervalLogStatus = "UPTODATE"
		}

		taskLogger.INFO("Interval [%s] %s", interval.String(), intervalLogStatus)
	}

	taskLogger.INFO("Intervals to sync: [%d]", len(intervalsToSync))

	collectionTableName := driver.GetCollectionTable()
	reformattedTableName := schema.Reformat(collectionTableName)
	for _, intervalToSync := range intervalsToSync {
		taskLogger.INFO("Running [%s] synchronization", intervalToSync.String())

		objects, err := driver.GetObjectsFor(intervalToSync)
		if err != nil {
			return fmt.Errorf("Error [%s] synchronization: %v", intervalToSync.String(), err)
		}

		//Note: we assume that destinations connected to 1 source can't have different unique ID configuration
		uniqueIDField := destinationStorages[0].GetUniqueIDField()
		for _, object := range objects {
			//enrich with values
			object[events.SrcKey] = srcSource
			object[timestamp.Key] = timestamp.NowUTC()
			if err := uniqueIDField.Set(object, uuid.GetHash(object)); err != nil {
				b, _ := json.Marshal(object)
				return fmt.Errorf("Error setting unique ID field into %s: %v", string(b), err)
			}
			events.EnrichWithCollection(object, task.Collection)
			events.EnrichWithTimeInterval(object, intervalToSync.String(), intervalToSync.LowerEndpoint(), intervalToSync.UpperEndpoint())
		}
		rowsCount := len(objects)
		for _, storage := range destinationStorages {
			err := storage.SyncStore(&schema.BatchHeader{TableName: reformattedTableName}, objects, intervalToSync.String(), false)
			if err != nil {
				metrics.ErrorSourceEvents(task.Source, storage.ID(), rowsCount)
				metrics.ErrorObjects(task.Source, rowsCount)
				telemetry.Error(task.Source, storage.ID(), srcSource, rowsCount)
				counters.ErrorPullDestinationEvents(storage.ID(), rowsCount)
				counters.ErrorPullSourceEvents(task.Source, rowsCount)
				return fmt.Errorf("Error storing %d source objects in [%s] destination: %v", rowsCount, storage.ID(), err)
			}

			metrics.SuccessSourceEvents(task.Source, storage.ID(), rowsCount)
			metrics.SuccessObjects(task.Source, rowsCount)
			telemetry.Event(task.Source, storage.ID(), srcSource, rowsCount)
			counters.SuccessPullDestinationEvents(storage.ID(), rowsCount)
		}

		counters.SuccessPullSourceEvents(task.Source, rowsCount)

		if err := te.metaStorage.SaveSignature(task.Source, collectionMetaKey, intervalToSync.String(), intervalToSync.CalculateSignatureFrom(now, refreshWindow)); err != nil {
			logging.SystemErrorf("Unable to save source: [%s] collection: [%s] meta key: [%s] signature: %v", task.Source, task.Collection, collectionMetaKey, err)
		}

		taskLogger.INFO("Interval [%s] has been synchronized!", intervalToSync.String())
	}

	return nil
}

//syncCLI syncs singer/airbyte source
//returns err if occurred
func (te *TaskExecutor) syncCLI(task *meta.Task, taskLogger *TaskLogger, cliDriver driversbase.CLIDriver,
	destinationStorages []storages.Storage, taskCloser *TaskCloser) error {
	state, err := te.metaStorage.GetSignature(task.Source, cliDriver.GetTap(), driversbase.ALL.String())
	if err != nil {
		return fmt.Errorf("Error getting state from meta storage: %v", err)
	}

	if state != "" {
		taskLogger.INFO("Running synchronization with state: %s", state)
	} else {
		taskLogger.INFO("Running synchronization")
	}

	rs := NewResultSaver(task, cliDriver.GetTap(), cliDriver.GetCollectionMetaKey(), cliDriver.GetTableNamePrefix(), taskLogger, destinationStorages, te.metaStorage, cliDriver.GetStreamTableNameMapping())

	err = cliDriver.Load(state, taskLogger, rs, taskCloser)
	if err != nil {
		return fmt.Errorf("Error synchronization: %v", err)
	}

	return nil
}

func (te *TaskExecutor) Close() error {
	te.closed = true

	if te.workersPool != nil {
		te.workersPool.Release()
	}

	return nil
}
