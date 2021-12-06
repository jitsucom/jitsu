package logging

import (
	"bytes"
	"encoding/json"
	"fmt"
	"github.com/jitsucom/jitsu/server/queue"
	"github.com/jitsucom/jitsu/server/safego"
	"go.uber.org/atomic"
	"io"
)

//AsyncLogger write json logs to file system in different goroutine
type AsyncLogger struct {
	writer             io.WriteCloser
	queue              queue.Queue
	showInGlobalLogger bool

	closed *atomic.Bool
}

//NewAsyncLogger creates AsyncLogger and run goroutine that's read from channel and write to file
func NewAsyncLogger(writer io.WriteCloser, showInGlobalLogger bool) *AsyncLogger {
	logger := &AsyncLogger{
		writer:             writer,
		queue:              queue.NewInMemory(),
		showInGlobalLogger: showInGlobalLogger,
		closed:             atomic.NewBool(false),
	}

	safego.RunWithRestart(func() {
		for {
			if logger.closed.Load() {
				break
			}

			event, err := logger.queue.Pop()
			if err != nil {
				Errorf("Error reading event from queue in async logger: %v", err)
				continue
			}

			bts, err := json.Marshal(event)
			if err != nil {
				Errorf("Error marshaling event to json in async logger: %v", err)
				continue
			}

			if logger.showInGlobalLogger {
				prettyJSONBytes, _ := json.MarshalIndent(&event, " ", " ")
				Info(string(prettyJSONBytes))
			}

			buf := bytes.NewBuffer(bts)
			buf.Write([]byte("\n"))

			if _, err := logger.writer.Write(buf.Bytes()); err != nil {
				Errorf("Error writing event to log file: %v", err)
				continue
			}
		}
	})

	return logger
}

//Consume gets event and puts it to channel
func (al *AsyncLogger) Consume(event map[string]interface{}, tokenID string) {
	if err := al.queue.Push(event); err != nil {
		b, _ := json.Marshal(event)
		SystemErrorf("error pushing event [%s] into the queue in async logger.Consume: %v", string(b), err)
	}
}

//ConsumeAny put interface{} to the channel
func (al *AsyncLogger) ConsumeAny(object interface{}) {
	if err := al.queue.Push(object); err != nil {
		b, _ := json.Marshal(object)
		SystemErrorf("error pushing event [%s] into the queue in async logger.ConsumeAny: %v", string(b), err)
	}
}

//Close underlying log file writer
func (al *AsyncLogger) Close() (resultErr error) {
	al.closed.Store(true)

	if err := al.writer.Close(); err != nil {
		return fmt.Errorf("Error closing writer: %v", err)
	}
	return nil
}
