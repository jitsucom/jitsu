package synchronization

import (
	"fmt"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	"time"
)

type TaskLogger struct {
	taskID      string
	metaStorage meta.Storage
}

func NewTaskLogger(taskID string, metaStorage meta.Storage) *TaskLogger {
	return &TaskLogger{taskID: taskID, metaStorage: metaStorage}
}

func (tl *TaskLogger) INFO(format string, v ...interface{}) {
	tl.log(format, logging.INFO.String(), v...)
}

func (tl *TaskLogger) ERROR(format string, v ...interface{}) {
	tl.log(format, logging.ERROR.String(), v...)
}

func (tl *TaskLogger) log(format, level string, v ...interface{}) {
	msg := "[" + tl.taskID + "] " + fmt.Sprintf(format, v...)
	logging.Debug(msg)

	err := tl.metaStorage.AppendTaskLog(tl.taskID, time.Now().UTC(), msg, level)
	if err != nil {
		logging.SystemErrorf("Error appending logs [%s] level [%s]: %v", msg, level, err)
	}
}
