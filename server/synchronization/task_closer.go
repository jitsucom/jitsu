package synchronization

import (
	"errors"
	"fmt"

	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
)

var ErrTaskHasBeenCanceled = errors.New("Synchronization has been canceled!")

//TaskCloser is responsible for graceful task closing (writing Redis status)
//checks if task is canceled
type TaskCloser struct {
	*meta.Task
	taskLogger          *TaskLogger
	metaStorage         meta.Storage
	notificationService *NotificationService
	notificationConfig  map[string]interface{}
	projectName         string
}

//TaskID returns task ID
func (tc *TaskCloser) TaskID() string {
	return tc.ID
}

//HandleCanceling checks if task is canceled and if so, returns ErrTaskHasBeenCanceled
//otherwise returns nil
func (tc *TaskCloser) HandleCanceling() error {
	task, err := tc.metaStorage.GetTask(tc.ID)
	if err != nil {
		logging.SystemErrorf("error getting task [%s] in handle task cancel func: %v", tc.ID, err)
		return nil
	}

	if task.Status == CANCELED.String() {
		return ErrTaskHasBeenCanceled
	}

	return nil
}

//CloseWithError writes closing with error logs
//if task isn't canceled - updates task status to FAILED in Redis
func (tc *TaskCloser) CloseWithError(msg string, systemErr bool) {
	if systemErr {
		logging.SystemErrorf("[%s] %s", tc.ID, msg)
	} else {
		logging.Errorf("[%s] %s", tc.ID, msg)
	}

	tc.taskLogger.ERROR(msg)

	if err := tc.HandleCanceling(); err == ErrTaskHasBeenCanceled {
		return
	}

	if err := tc.metaStorage.UpdateFinishedTask(tc.ID, FAILED.String()); err != nil {
		msg := fmt.Sprintf("Error updating failed task [%s] in meta.Storage: %v", tc.ID, err)
		logging.SystemError(msg)
		tc.taskLogger.ERROR(msg)
	}

	tc.notify(FAILED.String())
}

func (tc *TaskCloser) CloseWithSuccess() error {
	if err := tc.metaStorage.UpdateFinishedTask(tc.ID, SUCCESS.String()); err != nil {
		msg := fmt.Sprintf("Error updating success task [%s] in meta.Storage: %v", tc.ID, err)
		tc.CloseWithError(msg, true)
		return err
	}

	tc.notify(SUCCESS.String())
	return nil
}

func (tc *TaskCloser) notify(status string) {
	previousStatus := ""
	previousTask, err := tc.metaStorage.GetLastTask(tc.Source, tc.Collection, 1)
	if err != nil {
		logging.Warnf("[%s] Failed to get previous completed task status: %s", tc.ID, err)
	} else {
		previousStatus = previousTask.Status
	}

	if previousStatus != status {
		go tc.notificationService.Notify(LoggedTask{
			Task:          tc.Task,
			TaskLogger:    tc.taskLogger,
			Notifications: tc.notificationConfig,
			ProjectName:   tc.projectName,
			Status:        status,
		})
	}
}
