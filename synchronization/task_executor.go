package synchronization

import (
	"encoding/json"
	"fmt"
	"github.com/jitsucom/eventnative/destinations"
	"github.com/jitsucom/eventnative/drivers"
	"github.com/jitsucom/eventnative/events"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/meta"
	"github.com/jitsucom/eventnative/metrics"
	"github.com/jitsucom/eventnative/safego"
	"github.com/jitsucom/eventnative/schema"
	"github.com/jitsucom/eventnative/sources"
	"github.com/jitsucom/eventnative/storages"
	"github.com/jitsucom/eventnative/timestamp"
	"github.com/jitsucom/eventnative/uuid"
	"github.com/panjf2000/ants/v2"
	"time"
)

type TaskExecutor struct {
	workersPool        *ants.PoolWithFunc
	sourceService      *sources.Service
	destinationService *destinations.Service
	metaStorage        meta.Storage
	monitorKeeper      storages.MonitorKeeper

	closed bool
}

//NewTaskExecutor return TaskExecutor and run 2 goroutines (monitoring and queue observer)
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
	taskLogger.INFO("Running task...")

	task.Status = RUNNING.String()
	task.StartedAt = timestamp.NowUTC()
	err := te.metaStorage.UpsertTask(task)
	if err != nil {
		msg := fmt.Sprintf("Error updating running task [%s] in meta.Storage: %v", task.ID, err)
		te.handleError(task, taskLogger, msg, true)
		return
	}

	logging.Debugf("[TASK %s] Getting sync lock source [%s] collection [%s]...", task.ID, task.Source, task.Collection)
	collectionLock, err := te.monitorKeeper.Lock(task.Source, task.Collection)
	if err != nil {
		msg := fmt.Sprintf("Error getting lock source [%s] collection [%s] task [%s]", task.Source, task.Collection, task.ID)
		te.handleError(task, taskLogger, msg, true)
		return
	}
	logging.Debugf("[TASK %s] Lock obtained for source [%s] collection [%s]!", task.ID, task.Source, task.Collection)
	defer te.monitorKeeper.Unlock(collectionLock)

	sourceUnit, err := te.sourceService.GetSource(task.Source)
	if err != nil {
		msg := fmt.Sprintf("Error getting source in task [%s]: %v", task.ID, err)
		te.handleError(task, taskLogger, msg, true)
		return
	}

	driver, ok := sourceUnit.DriverPerCollection[task.Collection]
	if !ok {
		msg := fmt.Sprintf("Collection with id [%s] wasn't found in source [%s] in task [%s]", task.Collection, task.Source, task.ID)
		te.handleError(task, taskLogger, msg, true)
		return
	}

	//get destinations
	var destinationStorages []storages.Storage
	for _, destinationId := range sourceUnit.DestinationIds {
		storageProxy, ok := te.destinationService.GetStorageById(destinationId)
		if ok {
			storage, ok := storageProxy.Get()
			if ok {
				destinationStorages = append(destinationStorages, storage)
			} else {
				msg := fmt.Sprintf("Unable to get destination [%s] in source [%s]: destination isn't initialized", destinationId, task.Source)
				logging.SystemError(msg)
				taskLogger.ERROR(msg)
			}
		} else {
			msg := fmt.Sprintf("Unable to get destination [%s] in source [%s]: doesn't exist", destinationId, task.Source)
			logging.SystemError(msg)
			taskLogger.ERROR(msg)
		}
	}

	if len(destinationStorages) == 0 {
		msg := fmt.Sprintf("Empty destinations. Task [%s] will be skipped", task.ID)
		te.handleError(task, taskLogger, msg, false)
		return
	}

	//** Task execution **
	start := time.Now().UTC()

	var taskErr error
	if driver.Type() == drivers.SingerType {
		singerDriver, _ := driver.(*drivers.Singer)

		ready, notReadyError := singerDriver.Ready()
		if !ready {
			te.handleError(task, taskLogger, notReadyError.Error(), false)
			return
		}

		taskErr = te.syncSinger(task, taskLogger, singerDriver, destinationStorages)
	} else {
		taskErr = te.sync(task, taskLogger, driver, destinationStorages)
	}

	if taskErr != nil {
		te.handleError(task, taskLogger, taskErr.Error(), false)
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
		te.handleError(task, taskLogger, msg, true)
		return
	}
}

//sync source. Return error if occurred
func (te *TaskExecutor) sync(task *meta.Task, taskLogger *TaskLogger, driver drivers.Driver, destinationStorages []storages.Storage) error {
	now := time.Now().UTC()

	intervals, err := driver.GetAllAvailableIntervals()
	if err != nil {
		return fmt.Errorf("Error getting all available intervals: %v", err)
	}

	taskLogger.INFO("Total intervals: [%d]", len(intervals))
	collectionMetaKey := task.Collection + "_" + driver.GetCollectionTable()

	var intervalsToSync []*drivers.TimeInterval
	for _, interval := range intervals {
		storedSignature, err := te.metaStorage.GetSignature(task.Source, collectionMetaKey, interval.String())
		if err != nil {
			return fmt.Errorf("Error getting interval [%s] signature: %v", interval.String(), err)
		}

		nowSignature := interval.CalculateSignatureFrom(now)

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

	collectionTable := driver.GetCollectionTable()
	for _, intervalToSync := range intervalsToSync {
		taskLogger.INFO("Running [%s] synchronization", intervalToSync.String())

		objects, err := driver.GetObjectsFor(intervalToSync)
		if err != nil {
			return fmt.Errorf("Error [%s] synchronization: %v", intervalToSync.String(), err)
		}

		for _, object := range objects {
			//enrich with values
			object["src"] = "source"
			object[timestamp.Key] = timestamp.NowUTC()
			events.EnrichWithEventId(object, uuid.GetHash(object))
			events.EnrichWithCollection(object, task.Collection)
			events.EnrichWithTimeInterval(object, intervalToSync.String(), intervalToSync.LowerEndpoint(), intervalToSync.UpperEndpoint())
		}
		for _, storage := range destinationStorages {
			rowsCount, err := storage.SyncStore(&schema.BatchHeader{TableName: collectionTable}, objects, intervalToSync.String())
			if err != nil {
				metrics.ErrorSourceEvents(task.Source, storage.Name(), rowsCount)
				metrics.ErrorObjects(task.Source, rowsCount)
				return fmt.Errorf("Error storing %d source objects in [%s] destination: %v", rowsCount, storage.Name(), err)
			}

			metrics.SuccessSourceEvents(task.Source, storage.Name(), rowsCount)
			metrics.SuccessObjects(task.Source, rowsCount)
		}

		if err := te.metaStorage.SaveSignature(task.Source, collectionMetaKey, intervalToSync.String(), intervalToSync.CalculateSignatureFrom(now)); err != nil {
			logging.SystemErrorf("Unable to save source [%s] collection [%s] signature: %v", task.Source, task.Collection, err)
		}

		taskLogger.INFO("Interval [%s] has been synchronized!", intervalToSync.String())
	}

	return nil
}

//syncSinger sync singer source. Return err if occurred
func (te *TaskExecutor) syncSinger(task *meta.Task, taskLogger *TaskLogger, singerDriver *drivers.Singer, destinationStorages []storages.Storage) error {
	//get singer state
	singerState, err := te.metaStorage.GetSignature(task.Source, singerDriver.GetTap(), drivers.ALL.String())
	if err != nil {
		return fmt.Errorf("Error getting state from meta storage: %v", err)

	}

	if singerState != "" {
		taskLogger.INFO("Running synchronization with state: %s", singerState)
	} else {
		taskLogger.INFO("Running synchronization")
	}

	rs := NewResultSaver(task, singerDriver.GetTap(), taskLogger, destinationStorages, te.metaStorage)

	err = singerDriver.Load(singerState, taskLogger, rs)
	if err != nil {
		return fmt.Errorf("Error synchronization: %v", err)
	}

	return nil
}

//handleError write logs, update task status and logs in Redis
func (te *TaskExecutor) handleError(task *meta.Task, taskLogger *TaskLogger, msg string, systemErr bool) {
	if systemErr {
		logging.SystemErrorf("[%s] "+msg, task.ID)
	} else {
		logging.Errorf("[%s] "+msg, task.ID)
	}

	taskLogger.ERROR(msg)
	task.Status = FAILED.String()
	task.FinishedAt = time.Now().UTC().Format(timestamp.Layout)

	err := te.metaStorage.UpsertTask(task)
	if err != nil {
		msg := fmt.Sprintf("Error updating failed task [%s] in meta.Storage: %v", task.ID, err)
		logging.SystemError(msg)
		taskLogger.ERROR(msg)
		return
	}
}

func (te *TaskExecutor) Close() error {
	te.closed = true

	if te.workersPool != nil {
		te.workersPool.Release()
	}

	return nil
}
