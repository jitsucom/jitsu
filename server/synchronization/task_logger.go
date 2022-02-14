package synchronization

import (
	"fmt"
	"sync"

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
	buf         []string
	mu          sync.Mutex
}

//NewTaskLogger returns configured TaskLogger instance
func NewTaskLogger(taskID string, metaStorage meta.Storage) *TaskLogger {
	return &TaskLogger{taskID: taskID, metaStorage: metaStorage, buf: make([]string, 0)}
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

	now := timestamp.Now()
	err := tl.metaStorage.AppendTaskLog(tl.taskID, now.UTC(), system, msg, level.String())
	if err != nil {
		logging.SystemErrorf("Error appending logs [%s] system [%s] level [%s]: %v", msg, system, level.String(), err)
	}

	tl.appendBuf(fmt.Sprintf("[%s] %s", level.String(), fmt.Sprintf(format, v...)))
}

func (tl *TaskLogger) appendBuf(msg string) {
	tl.mu.Lock()
	defer tl.mu.Unlock()
	tl.buf = append(tl.buf, msg)
}

func (tl *TaskLogger) Collect() []string {
	tl.mu.Lock()
	defer tl.mu.Unlock()
	result := make([]string, len(tl.buf))
	copy(result, tl.buf)
	return result
}
