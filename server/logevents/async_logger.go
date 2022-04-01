package logevents

import (
	"bytes"
	"encoding/json"
	"fmt"
	"github.com/jitsucom/jitsu/server/logging"
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
func NewAsyncLogger(writer io.WriteCloser, showInGlobalLogger bool, poolSize int) *AsyncLogger {
	logger := &AsyncLogger{
		writer:             writer,
		queue:              queue.NewInMemory(100_000),
		showInGlobalLogger: showInGlobalLogger,
		closed:             atomic.NewBool(false),
	}

	for i := 0; i < poolSize; i++ {
		safego.RunWithRestart(logger.startObserver)
	}

	return logger
}

func (al *AsyncLogger) startObserver() {
	for {
		if al.closed.Load() {
			break
		}

		event, err := al.queue.Pop()
		if err != nil {
			logging.Errorf("Error reading event from queue in async logger: %v", err)
			continue
		}

		al.write(event)
	}
}

func (al *AsyncLogger) write(event interface{}) {
	bts, err := json.Marshal(event)
	if err != nil {
		logging.Errorf("Error marshaling event to json in async logger: %v", err)
		return
	}

	if al.showInGlobalLogger {
		prettyJSONBytes, _ := json.MarshalIndent(&event, " ", " ")
		logging.Info(string(prettyJSONBytes))
	}

	buf := bytes.NewBuffer(bts)
	buf.Write([]byte("\n"))

	if _, err := al.writer.Write(buf.Bytes()); err != nil {
		logging.Errorf("Error writing event to log file: %v", err)
	}
}

//Consume gets event and puts it to channel
func (al *AsyncLogger) Consume(event map[string]interface{}, tokenID string) {
	if err := al.queue.Push(event); err != nil {
		b, _ := json.Marshal(event)
		logging.SystemErrorf("error pushing event [%s] into the queue in async logger.Consume: %v", string(b), err)
	}
}

//ConsumeAny put interface{} to the channel
func (al *AsyncLogger) ConsumeAny(object interface{}) {
	if err := al.queue.Push(object); err != nil {
		b, _ := json.Marshal(object)
		logging.SystemErrorf("error pushing event [%s] into the queue in async logger.ConsumeAny: %v", string(b), err)
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
