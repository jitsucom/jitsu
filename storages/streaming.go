package storages

import (
	"github.com/jitsucom/eventnative/events"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/metrics"
	"github.com/jitsucom/eventnative/safego"
	"github.com/jitsucom/eventnative/schema"
	"strings"
	"time"
)

type StreamingStorage interface {
	events.Storage
	Insert(dataSchema *schema.Table, fact events.Fact) (err error)
}

//StreamingWorker reads events from queue and using events.StreamingStorage writes them
type StreamingWorker struct {
	eventQueue       *events.PersistentQueue
	schemaProcessor  *schema.Processor
	streamingStorage StreamingStorage

	closed bool
}

func newStreamingWorker(eventQueue *events.PersistentQueue, schemaProcessor *schema.Processor, streamingStorage StreamingStorage) *StreamingWorker {
	return &StreamingWorker{
		eventQueue:       eventQueue,
		schemaProcessor:  schemaProcessor,
		streamingStorage: streamingStorage,
	}
}

//Run goroutine to:
//1. read from queue
//2. Insert in events.StreamingStorage
func (sw *StreamingWorker) start() {
	safego.RunWithRestart(func() {
		for {
			if sw.closed {
				break
			}

			fact, dequeuedTime, tokenId, err := sw.eventQueue.DequeueBlock()
			if err != nil {
				if err == events.ErrQueueClosed && sw.closed {
					continue
				}
				logging.Errorf("[%s] Error reading event fact from queue: %v", sw.streamingStorage.Name(), err)
				continue
			}

			//dequeued event was from retry call and retry timeout hasn't come
			if time.Now().Before(dequeuedTime) {
				sw.eventQueue.ConsumeTimed(fact, dequeuedTime, tokenId)
				continue
			}

			dataSchema, flattenObject, err := sw.schemaProcessor.ProcessFact(fact)
			if err != nil {
				logging.Errorf("[%s] Unable to process object %v: %v", sw.streamingStorage.Name(), fact, err)
				metrics.ErrorTokenEvent(tokenId, sw.streamingStorage.Name())
				continue
			}

			//don't process empty object
			if !dataSchema.Exists() {
				continue
			}

			if err := sw.streamingStorage.Insert(dataSchema, flattenObject); err != nil {
				logging.Errorf("[%s] Error inserting to table [%s]: %v", sw.streamingStorage.Name(), dataSchema.Name, err)
				if strings.Contains(err.Error(), "connection refused") ||
					strings.Contains(err.Error(), "EOF") ||
					strings.Contains(err.Error(), "write: broken pipe") {
					sw.eventQueue.ConsumeTimed(fact, time.Now().Add(20*time.Second), tokenId)
				}
				metrics.ErrorTokenEvent(tokenId, sw.streamingStorage.Name())
				continue
			}
			metrics.SuccessTokenEvent(tokenId, sw.streamingStorage.Name())
		}
	})
}

func (sw *StreamingWorker) Close() error {
	sw.closed = true
	return nil
}
