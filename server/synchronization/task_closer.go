package synchronization

import (
	"fmt"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	"github.com/jitsucom/jitsu/server/timestamp"
	"time"
)

//TaskCloser is responsible for graceful task closing (writing Redis status)
type TaskCloser struct {
	task        *meta.Task
	taskLogger  *TaskLogger
	metaStorage meta.Storage
}

//NewTaskCloser returns configured TaskCloser
func NewTaskCloser(task *meta.Task, taskLogger *TaskLogger, metaStorage meta.Storage) *TaskCloser {
	return &TaskCloser{
		task:        task,
		taskLogger:  taskLogger,
		metaStorage: metaStorage,
	}
}

//TaskID returns task ID
func (tc *TaskCloser) TaskID() string {
	return tc.task.ID
}

//CloseWithError writes logs, updates task status and logs in Redis
func (tc *TaskCloser) CloseWithError(msg string, systemErr bool) {
	if systemErr {
		logging.SystemErrorf("[%s] %s", tc.task.ID, msg)
	} else {
		logging.Errorf("[%s] %s", tc.task.ID, msg)
	}

	tc.taskLogger.ERROR(msg)
	tc.task.Status = FAILED.String()
	tc.task.FinishedAt = time.Now().UTC().Format(timestamp.Layout)

	err := tc.metaStorage.UpsertTask(tc.task)
	if err != nil {
		msg := fmt.Sprintf("Error updating failed task [%s] in meta.Storage: %v", tc.task.ID, err)
		logging.SystemError(msg)
		tc.taskLogger.ERROR(msg)
		return
	}
}
