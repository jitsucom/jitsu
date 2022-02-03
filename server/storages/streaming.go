package storages

import (
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/safego"
	"github.com/jitsucom/jitsu/server/schema"
	"github.com/jitsucom/jitsu/server/timestamp"
	"github.com/jitsucom/jitsu/server/utils"
	"go.uber.org/atomic"
	"math/rand"
	"time"
)

//StreamingStorage supports Insert operation
type StreamingStorage interface {
	Storage
	//Insert uses errCallback in async adapters (e.g. adapters.HTTPAdapter)
	Insert(eventContext *adapters.EventContext) (err error)
	//SuccessEvent writes metrics/counters/events cache, etc
	SuccessEvent(eventCtx *adapters.EventContext)
	//ErrorEvent writes metrics/counters/events cache, etc
	ErrorEvent(fallback bool, eventCtx *adapters.EventContext, err error)
	//SkipEvent writes metrics/counters/events cache, etc
	SkipEvent(eventCtx *adapters.EventContext, err error)
}

//StreamingWorker reads events from queue and using events.StreamingStorage writes them
type StreamingWorker struct {
	eventQueue       events.Queue
	processor        *schema.Processor
	streamingStorage StreamingStorage
	tableHelper      []*TableHelper

	closed *atomic.Bool
}

//newStreamingWorker returns configured streaming worker
func newStreamingWorker(eventQueue events.Queue, processor *schema.Processor, streamingStorage StreamingStorage,
	tableHelper ...*TableHelper) (*StreamingWorker, error) {
	err := processor.InitJavaScriptTemplates()
	if err != nil {
		return nil, err
	}
	return &StreamingWorker{
		eventQueue:       eventQueue,
		processor:        processor,
		streamingStorage: streamingStorage,
		tableHelper:      tableHelper,
		closed:           atomic.NewBool(false),
	}, nil
}

//Run goroutine to:
//1. read from queue
//2. Insert in events.StreamingStorage
func (sw *StreamingWorker) start() {
	safego.RunWithRestart(func() {
		for {
			if sw.streamingStorage.IsStaging() {
				break
			}
			if sw.closed.Load() {
				break
			}

			fact, dequeuedTime, tokenID, err := sw.eventQueue.DequeueBlock()
			if err != nil {
				if err == events.ErrQueueClosed && sw.closed.Load() {
					continue
				}
				logging.SystemErrorf("[%s] Error reading event from queue: %v", sw.streamingStorage.ID(), err)
				time.Sleep(time.Second)
				continue
			}

			//dequeued event was from retry call and retry timeout hasn't come
			if timestamp.Now().Before(dequeuedTime) {
				sw.eventQueue.ConsumeTimed(fact, dequeuedTime, tokenID)
				continue
			}

			//is used in writing counters/metrics/events cache
			eventContext := &adapters.EventContext{
				CacheDisabled: sw.streamingStorage.IsCachingDisabled(),
				DestinationID: sw.streamingStorage.ID(),
				EventID:       sw.streamingStorage.GetUniqueIDField().Extract(fact),
				TokenID:       tokenID,
				Src:           events.ExtractSrc(fact),
				RawEvent:      fact,
			}

			envelops, err := sw.processor.ProcessEvent(fact)
			if err != nil {
				if err == schema.ErrSkipObject {
					if !appconfig.Instance.DisableSkipEventsWarn {
						logging.Warnf("[%s] Event [%s]: %v", sw.streamingStorage.ID(), sw.streamingStorage.GetUniqueIDField().Extract(fact), err)
					}

					sw.streamingStorage.SkipEvent(eventContext, err)
				} else {
					logging.Errorf("[%s] Unable to process object %s: %v", sw.streamingStorage.ID(), fact.Serialize(), err)
					sw.streamingStorage.ErrorEvent(true, eventContext, err)
				}

				continue
			}
			for _, envelop := range envelops {
				batchHeader := envelop.Header
				flattenObject := envelop.Event
				//don't process empty object
				if !batchHeader.Exists() {
					continue
				}

				table := sw.getTableHelper().MapTableSchema(batchHeader)
				eventContext := &adapters.EventContext{
					CacheDisabled: sw.streamingStorage.IsCachingDisabled(),
					DestinationID: sw.streamingStorage.ID(),
					EventID: utils.NvlString(sw.streamingStorage.GetUniqueIDField().Extract(flattenObject),
						sw.streamingStorage.GetUniqueIDField().Extract(fact)),
					TokenID:        tokenID,
					Src:            events.ExtractSrc(fact),
					RawEvent:       fact,
					ProcessedEvent: flattenObject,
					Table:          table,
				}

				if err := sw.streamingStorage.Insert(eventContext); err != nil {
					logging.Errorf("[%s] Error inserting object %s to table [%s]: %v", sw.streamingStorage.ID(), flattenObject.Serialize(), table.Name, err)
					if IsConnectionError(err) {
						//retry
						sw.eventQueue.ConsumeTimed(fact, timestamp.Now().Add(20*time.Second), tokenID)
					}

					continue
				}
			}
		}
	})
}

func (sw *StreamingWorker) Close() error {
	sw.closed.Store(true)

	return nil
}

func (sw *StreamingWorker) getTableHelper() *TableHelper {
	num := rand.Intn(len(sw.tableHelper))
	return sw.tableHelper[num]
}
