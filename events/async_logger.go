package events

import (
	"bytes"
	"encoding/json"
	"fmt"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/safego"
	"io"
)

//AsyncLogger write json logs to file system in different goroutine
type AsyncLogger struct {
	writer             io.WriteCloser
	logCh              chan Fact
	showInGlobalLogger bool
}

//Consume event fact and put it to channel
func (al *AsyncLogger) Consume(fact Fact, tokenId string) {
	al.logCh <- fact
}

//Close underlying log file writer
func (al *AsyncLogger) Close() (resultErr error) {
	if err := al.writer.Close(); err != nil {
		return fmt.Errorf("Error closing writer: %v", err)
	}
	return nil
}

//Create AsyncLogger and run goroutine that's read from channel and write to file
func NewAsyncLogger(writer io.WriteCloser, showInGlobalLogger bool) Consumer {
	logger := &AsyncLogger{writer: writer, logCh: make(chan Fact, 20000), showInGlobalLogger: showInGlobalLogger}

	safego.RunWithRestart(func() {
		for {
			fact := <-logger.logCh
			bts, err := json.Marshal(fact)
			if err != nil {
				logging.Errorf("Error marshaling event to json: %v", err)
				continue
			}

			if logger.showInGlobalLogger {
				prettyJsonBytes, _ := json.MarshalIndent(&fact, " ", " ")
				logging.Info(string(prettyJsonBytes))
			}

			buf := bytes.NewBuffer(bts)
			buf.Write([]byte("\n"))

			if _, err := logger.writer.Write(buf.Bytes()); err != nil {
				logging.Errorf("Error writing event to log file: %v", err)
				continue
			}
		}
	})

	return logger
}
