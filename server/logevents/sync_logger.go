package logevents

import (
	"bytes"
	"encoding/json"
	"fmt"
	"github.com/jitsucom/jitsu/server/logging"
	"io"
)

//SyncLogger writes json logs to file system immediately
type SyncLogger struct {
	writer             io.WriteCloser
	showInGlobalLogger bool
}

//NewSyncLogger creates configured SyncLogger
func NewSyncLogger(writer io.WriteCloser, showInGlobalLogger bool) *SyncLogger {
	return &SyncLogger{writer: writer, showInGlobalLogger: showInGlobalLogger}
}

//Consume uses write func
func (sl *SyncLogger) Consume(event map[string]interface{}, tokenID string) {
	sl.write(event)
}

//ConsumeAny uses write func
func (sl *SyncLogger) ConsumeAny(object interface{}) {
	sl.write(object)
}

//Close underlying log file writer
func (sl *SyncLogger) Close() (resultErr error) {
	if err := sl.writer.Close(); err != nil {
		return fmt.Errorf("Error closing writer: %v", err)
	}
	return nil
}

func (sl *SyncLogger) write(event interface{}) {
	bts, err := json.Marshal(event)
	if err != nil {
		logging.Errorf("Error marshaling event to json in sync logger: %v", err)
		return
	}

	if sl.showInGlobalLogger {
		prettyJSONBytes, _ := json.MarshalIndent(&event, " ", " ")
		logging.Info(string(prettyJSONBytes))
	}

	buf := bytes.NewBuffer(bts)
	buf.Write([]byte("\n"))

	if _, err := sl.writer.Write(buf.Bytes()); err != nil {
		logging.Errorf("Error writing event to log file: %v", err)
	}
}
