package synchronization

import (
	"fmt"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	"time"
)

const (
	jitsuSystem  = "Jitsu"
	singerSystem = "Singer"
)

//TaskLogger is a logger for writing logs to underlying Redis (meta.Storage)
type TaskLogger struct {
	taskID      string
	metaStorage meta.Storage
}

//NewTaskLogger returns configured TaskLogger instance
func NewTaskLogger(taskID string, metaStorage meta.Storage) *TaskLogger {
	return &TaskLogger{taskID: taskID, metaStorage: metaStorage}
}

//Write writes Singer bytes as a record into meta.Storage
func (tl *TaskLogger) Write(p []byte) (n int, err error) {
	tl.log(string(p), singerSystem, logging.DEBUG.String())
	return len(p), nil
}

//INFO writes record into meta.storage with log level INFO
func (tl *TaskLogger) INFO(format string, v ...interface{}) {
	tl.log(format, jitsuSystem, logging.INFO.String(), v...)
}

//ERROR writes record into meta.storage with log level ERROR
func (tl *TaskLogger) ERROR(format string, v ...interface{}) {
	tl.log(format, jitsuSystem, logging.ERROR.String(), v...)
}

func (tl *TaskLogger) log(format, system, level string, v ...interface{}) {
	msg := "[" + tl.taskID + "] " + fmt.Sprintf(format, v...)
	logging.Debug(msg)

	err := tl.metaStorage.AppendTaskLog(tl.taskID, time.Now().UTC(), system, msg, level)
	if err != nil {
		logging.SystemErrorf("Error appending logs [%s] system [%s] level [%s]: %v", msg, system, level, err)
	}
}
