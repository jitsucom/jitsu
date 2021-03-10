package synchronization

import (
	"fmt"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/meta"
	"time"
)

type TaskLogger struct {
	taskId      string
	metaStorage meta.Storage
}

func NewTaskLogger(taskId string, metaStorage meta.Storage) *TaskLogger {
	return &TaskLogger{taskId: taskId, metaStorage: metaStorage}
}

func (tl *TaskLogger) INFO(format string, v ...interface{}) {
	tl.log(format, logging.INFO.String(), v...)
}

func (tl *TaskLogger) ERROR(format string, v ...interface{}) {
	tl.log(format, logging.ERROR.String(), v...)
}

func (tl *TaskLogger) log(format, level string, v ...interface{}) {
	msg := "[" + tl.taskId + "] " + fmt.Sprintf(format, v...)
	err := tl.metaStorage.AppendTaskLog(tl.taskId, time.Now().UTC(), msg, level)
	if err != nil {
		logging.SystemErrorf("Error appending logs [%s] level [%s]: %v", msg, level, err)
	}
}
