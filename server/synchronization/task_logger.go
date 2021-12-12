package synchronization

import (
	"fmt"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	"github.com/jitsucom/jitsu/server/timestamp"
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
	tl.LOG(string(p), singerSystem, logging.DEBUG)
	return len(p), nil
}

//INFO writes record into meta.storage with log level INFO
func (tl *TaskLogger) INFO(format string, v ...interface{}) {
	tl.LOG(format, jitsuSystem, logging.INFO, v...)
}

//ERROR writes record into meta.storage with log level ERROR
func (tl *TaskLogger) ERROR(format string, v ...interface{}) {
	tl.LOG(format, jitsuSystem, logging.ERROR, v...)
}

//WARN writes record into meta.storage with log level WARN
func (tl *TaskLogger) WARN(format string, v ...interface{}) {
	tl.LOG(format, jitsuSystem, logging.WARN, v...)
}

func (tl *TaskLogger) LOG(format, system string, level logging.Level, v ...interface{}) {
	msg := "[" + tl.taskID + "] " + fmt.Sprintf(format, v...)
	logging.Debug(msg)

	err := tl.metaStorage.AppendTaskLog(tl.taskID, timestamp.Now().UTC(), system, msg, level.String())
	if err != nil {
		logging.SystemErrorf("Error appending logs [%s] system [%s] level [%s]: %v", msg, system, level.String(), err)
	}
}
