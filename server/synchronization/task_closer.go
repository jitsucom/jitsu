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
	taskID      string
	taskLogger  *TaskLogger
	metaStorage meta.Storage
}

//NewTaskCloser returns configured TaskCloser
func NewTaskCloser(taskID string, taskLogger *TaskLogger, metaStorage meta.Storage) *TaskCloser {
	return &TaskCloser{
		taskID:      taskID,
		taskLogger:  taskLogger,
		metaStorage: metaStorage,
	}
}

//TaskID returns task ID
func (tc *TaskCloser) TaskID() string {
	return tc.taskID
}

//HandleCanceling checks if task is canceled and if so, returns ErrTaskHasBeenCanceled
//otherwise returns nil
func (tc *TaskCloser) HandleCanceling() error {
	task, err := tc.metaStorage.GetTask(tc.taskID)
	if err != nil {
		logging.SystemErrorf("error getting task [%s] in handle task cancel func: %v", tc.taskID, err)
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
		logging.SystemErrorf("[%s] %s", tc.taskID, msg)
	} else {
		logging.Errorf("[%s] %s", tc.taskID, msg)
	}

	tc.taskLogger.ERROR(msg)

	if err := tc.HandleCanceling(); err == ErrTaskHasBeenCanceled {
		return
	}

	err := tc.metaStorage.UpdateFinishedTask(tc.taskID, FAILED.String())
	if err != nil {
		msg := fmt.Sprintf("Error updating failed task [%s] in meta.Storage: %v", tc.taskID, err)
		logging.SystemError(msg)
		tc.taskLogger.ERROR(msg)
		return
	}
}
