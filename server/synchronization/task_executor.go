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
	"go.uber.org/atomic"
	"strings"
	"time"
)

const srcSource = "source"

type TaskExecutor struct {
	workersPool        *ants.PoolWithFunc
	sourceService      *sources.Service
	destinationService *destinations.Service
	metaStorage        meta.Storage
	monitorKeeper      storages.MonitorKeeper

	stalledThreshold      time.Duration
	lastActivityThreshold time.Duration
	observerStalledEvery  time.Duration
	closed                *atomic.Bool
}

//NewTaskExecutor returns TaskExecutor and starts 2 goroutines (monitoring and queue observer)
func NewTaskExecutor(poolSize, stalledThresholdSeconds, stalledLastActivityThresholdMinutes, observeStalledTaskEverySeconds int, sourceService *sources.Service, destinationService *destinations.Service, metaStorage meta.Storage, monitorKeeper storages.MonitorKeeper) (*TaskExecutor, error) {
	executor := &TaskExecutor{
		sourceService:         sourceService,
		destinationService:    destinationService,
		metaStorage:           metaStorage,
		monitorKeeper:         monitorKeeper,
		stalledThreshold:      time.Duration(stalledThresholdSeconds) * time.Second,
		lastActivityThreshold: time.Duration(stalledLastActivityThresholdMinutes) * time.Minute,
		observerStalledEvery:  time.Duration(observeStalledTaskEverySeconds) * time.Second,
		closed:                atomic.NewBool(false),
	}
	pool, err := ants.NewPoolWithFunc(poolSize, executor.execute)
	if err != nil {
		return nil, fmt.Errorf("Error creating goroutines pool: %v", err)
	}

	executor.workersPool = pool
	executor.startMonitoring()
	executor.startObserver()
	executor.startTaskController()
	//this func is for recording all existed tasks (previous Jitsu versions don't write heartbeat in Redis)
	//it also helps to close all stalled tasks
	safego.Run(executor.initialHeartbeat)

	return executor, nil
}

//initialHeartbeat gets all stalled tasks and does initial heartbeat
//it helps to close tasks which were created in previous Jitsu versions
func (te *TaskExecutor) initialHeartbeat() {
	taskIDs, err := te.metaStorage.GetAllTasksForInitialHeartbeat(RUNNING.String(), SCHEDULED.String(), te.lastActivityThreshold)
	if err != nil {
		logging.SystemErrorf("error getting all tasks ids for initial heartbeat: %v", err)
		return
	}

	if len(taskIDs) > 0 {
		logging.Infof("Tasks for initial heartbeat:\n%s", strings.Join(taskIDs, "\b\n"))

		for _, taskID := range taskIDs {
			if hbErr := te.metaStorage.TaskHeartBeat(taskID); hbErr != nil {
				logging.SystemErrorf("error in task [%s] initial heartbeat: %v", taskID, hbErr)
			}
		}
	}
}

//startTaskController runs goroutine for controlling task heartbeat. If a task doesn't send heartbeat 1 time per 10 sec
//(last heart beat was > stalled_threshold ago) and status isn't SUCCESS or FAILED -> change its status to FAILED
func (te *TaskExecutor) startTaskController() {
	safego.RunWithRestart(func() {
		for {
			if te.closed.Load() {
				break
			}

			tasksHeartBeats, err := te.metaStorage.GetAllTasksHeartBeat()
			if err != nil {
				logging.SystemErrorf("error getting all tasks heartbeat: %v", err)
				time.Sleep(5 * time.Second)
				continue
			}

			for taskID, lastHeartBeat := range tasksHeartBeats {
				lastHeartBeatTime, err := time.Parse(time.RFC3339Nano, lastHeartBeat)
				if err != nil {
					logging.SystemErrorf("error parsing task [%s] heartbeat timestamp str [%s]: %v", taskID, lastHeartBeat, err)
					continue
				}

				if time.Now().UTC().Before(lastHeartBeatTime.Add(te.stalledThreshold)) {
					//not enough time
					continue
				}

				//check and update the status
				task, err := te.metaStorage.GetTask(taskID)
				if err != nil {
					logging.SystemErrorf("error getting task by id [%s] in heartbeat controller: %v", taskID, err)
					continue
				}

				if task.Status == RUNNING.String() || task.Status == SCHEDULED.String() {
					taskLogger := NewTaskLogger(task.ID, te.metaStorage)
					taskCloser := NewTaskCloser(task.ID, taskLogger, te.metaStorage)
					stalledTimeAgo := time.Now().UTC().Sub(lastHeartBeatTime)

					errMsg := fmt.Sprintf("The task is marked as Stalled. Jitsu has not received any updates from this task [%.2f] seconds (~ %.2f minutes). It might happen due to server restart. Sometimes out of memory errors might be a cause. You can check application logs and if so, please give Jitsu more RAM.", stalledTimeAgo.Seconds(), stalledTimeAgo.Minutes())
					taskCloser.CloseWithError(errMsg, false)

					if err := te.monitorKeeper.UnlockCleanUp(task.Source, task.Collection); err != nil {
						logging.SystemErrorf("error unlocking task [%s] from heartbeat: %v", taskID, err)
					}
				}

				if err := te.metaStorage.RemoveTaskFromHeartBeat(taskID); err != nil {
					logging.SystemErrorf("error removing task [%s] from heartbeat: %v", taskID, err)
				}

			}

			time.Sleep(te.observerStalledEvery)
		}
	})
}

//startMonitoring run goroutine for setting pool size metrics every 20 seconds
func (te *TaskExecutor) startMonitoring() {
	safego.RunWithRestart(func() {
		for {
			if te.closed.Load() {
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
			if te.closed.Load() {
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

//execute runs task validating and syncing (cli or plain)
func (te *TaskExecutor) execute(i interface{}) {
	task, ok := i.(*meta.Task)
	if !ok {
		taskPayload, _ := json.Marshal(i)
		logging.SystemErrorf("Meta task [%s] has unknown type: %T", string(taskPayload), i)
		return
	}

	//create redis logger
	taskLogger := NewTaskLogger(task.ID, te.metaStorage)
	taskCloser := NewTaskCloser(task.ID, taskLogger, te.metaStorage)

	if taskCloser.HandleCanceling() == ErrTaskHasBeenCanceled {
		return
	}

	//run the task
	logging.Infof("[%s] Running task...", task.ID)
	taskLogger.INFO("Running task with id: %s", task.ID)

	err := te.metaStorage.UpdateStartedTask(task.ID, RUNNING.String())
	if err != nil {
		msg := fmt.Sprintf("Error updating started task [%s] in meta.Storage: %v", task.ID, err)
		taskCloser.CloseWithError(msg, true)
		return
	}

	//task heartbeat
	taskDone := make(chan struct{})
	defer close(taskDone)
	safego.Run(func() {
		//first heart beat
		if hbErr := te.metaStorage.TaskHeartBeat(task.ID); hbErr != nil {
			logging.SystemErrorf("error in task [%s] first heartbeat: %v", task.ID, hbErr)
		}

		//every 10 seconds
		ticker := time.NewTicker(10 * time.Second)
		for {
			select {
			case <-taskDone:
				return
			case <-ticker.C:
				if hbErr := te.metaStorage.TaskHeartBeat(task.ID); hbErr != nil {
					logging.SystemErrorf("error in task [%s] heartbeat: %v", task.ID, hbErr)
				}
			}
		}
	})

	taskLogger.INFO("Acquiring lock...")
	logging.Debugf("[TASK %s] Getting sync lock source [%s] collection [%s]...", task.ID, task.Source, task.Collection)
	collectionLock, err := te.monitorKeeper.Lock(task.Source, task.Collection)
	if err != nil {
		msg := fmt.Sprintf("Error getting lock source [%s] collection [%s] task [%s]: %v", task.Source, task.Collection, task.ID, err)
		taskCloser.CloseWithError(msg, true)
		return
	}
	taskLogger.INFO("Lock has been acquired!")
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
		taskErr = te.sync(task, taskLogger, driver, destinationStorages, taskCloser)
	}

	if taskErr != nil {
		if taskErr == ErrTaskHasBeenCanceled {
			return
		}

		taskCloser.CloseWithError(taskErr.Error(), false)
		return
	}

	end := time.Now().UTC().Sub(start)
	taskLogger.INFO("FINISHED SUCCESSFULLY in [%.2f] seconds (~ %.2f minutes)", end.Seconds(), end.Minutes())
	logging.Infof("[%s] FINISHED SUCCESSFULLY in [%.2f] seconds (~ %.2f minutes)", task.ID, end.Seconds(), end.Minutes())

	err = te.metaStorage.UpdateFinishedTask(task.ID, SUCCESS.String())
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
	destinationStorages []storages.Storage, taskCloser *TaskCloser) error {
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
		if err := taskCloser.HandleCanceling(); err != nil {
			return err
		}

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
		if err := taskCloser.HandleCanceling(); err != nil {
			return err
		}

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
				counters.ErrorEvents(storage.ID(), rowsCount)
				return fmt.Errorf("Error storing %d source objects in [%s] destination: %v", rowsCount, storage.ID(), err)
			}

			metrics.SuccessSourceEvents(task.Source, storage.ID(), rowsCount)
			metrics.SuccessObjects(task.Source, rowsCount)
			telemetry.Event(task.Source, storage.ID(), srcSource, rowsCount)
			counters.SuccessEvents(storage.ID(), rowsCount)
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
func (te *TaskExecutor) syncCLI(task *meta.Task, taskLogger *TaskLogger, cliDriver driversbase.CLIDriver,
	destinationStorages []storages.Storage, taskCloser *TaskCloser) error {
	state, err := te.metaStorage.GetSignature(task.Source, cliDriver.GetCollectionMetaKey(), driversbase.ALL.String())
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
		if err == ErrTaskHasBeenCanceled {
			return err
		}

		return fmt.Errorf("Error synchronization: %v", err)
	}

	return nil
}

func (te *TaskExecutor) Close() error {
	te.closed.Store(true)

	if te.workersPool != nil {
		te.workersPool.Release()
	}

	return nil
}
