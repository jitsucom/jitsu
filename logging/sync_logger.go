package logging

import (
	"fmt"
	"io"
	"log"
)

//SyncLogger write logs to file system synchronously
type SyncLogger struct {
	logger *log.Logger
	writer io.WriteCloser
}

//Create SyncLogger
func NewSyncLogger(writer io.WriteCloser) *SyncLogger {
	logger := log.New(writer, "", log.Ldate|log.Ltime|log.LUTC)

	return &SyncLogger{logger: logger, writer: writer}
}

func (sl *SyncLogger) Errorf(format string, v ...interface{}) {
	sl.Error(fmt.Sprintf(format, v...))
}

func (sl *SyncLogger) Error(v ...interface{}) {
	sl.logger.Println(append([]interface{}{errPrefix}, v...)...)
}

func (sl *SyncLogger) Infof(format string, v ...interface{}) {
	sl.Info(fmt.Sprintf(format, v...))
}

func (sl *SyncLogger) Info(v ...interface{}) {
	sl.logger.Println(append([]interface{}{infoPrefix}, v...)...)
}

func (sl *SyncLogger) Warnf(format string, v ...interface{}) {
	sl.Warn(fmt.Sprintf(format, v...))
}

func (sl *SyncLogger) Warn(v ...interface{}) {
	sl.logger.Println(append([]interface{}{warnPrefix}, v...)...)
}

//Close underlying log file writer
func (sl *SyncLogger) Close() (resultErr error) {
	if err := sl.writer.Close(); err != nil {
		return fmt.Errorf("Error closing writer: %v", err)
	}
	return nil
}
