package storages

import (
	"fmt"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/errorj"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/safego"
	"github.com/jitsucom/jitsu/server/schema"
	"github.com/jitsucom/jitsu/server/timestamp"
	"github.com/jitsucom/jitsu/server/utils"
	"go.uber.org/atomic"
	"math"
	"math/rand"
	"time"
)

// StreamingStorage supports Insert operation
type StreamingStorage interface {
	Storage
	//Insert uses errCallback in async adapters (e.g. adapters.HTTPAdapter)
	Insert(eventContext *adapters.EventContext) (err error)

	Update(eventContext *adapters.EventContext) (err error)
	//SuccessEvent writes metrics/counters/events cache, etc
	SuccessEvent(eventCtx *adapters.EventContext)
	//ErrorEvent writes metrics/counters/events cache, etc
	ErrorEvent(fallback bool, eventCtx *adapters.EventContext, err error)
	//SkipEvent writes metrics/counters/events cache, etc
	SkipEvent(eventCtx *adapters.EventContext, err error)
}

// StreamingWorker reads events from queue and using events.StreamingStorage writes them
type StreamingWorker struct {
	eventQueue       events.Queue
	streamingStorage StreamingStorage
	tableHelper      []*TableHelper

	closed *atomic.Bool
}

// newStreamingWorker returns configured streaming worker
func newStreamingWorker(eventQueue events.Queue, streamingStorage StreamingStorage, tableHelper ...*TableHelper) *StreamingWorker {
	return &StreamingWorker{
		eventQueue:       eventQueue,
		streamingStorage: streamingStorage,
		tableHelper:      tableHelper,
		closed:           atomic.NewBool(false),
	}
}

// newStreamingWorkers returns configured streaming workers
func newStreamingWorkers(eventQueue events.Queue, streamingStorage StreamingStorage, workersCount int, tableHelper ...*TableHelper) []*StreamingWorker {
	workers := make([]*StreamingWorker, workersCount)
	for i := 0; i < workersCount; i++ {
		workers[i] = newStreamingWorker(eventQueue, streamingStorage, tableHelper...)
	}
	return workers
}

// Run goroutine to:
// 1. read from queue
// 2. Insert in events.StreamingStorage
func (sw *StreamingWorker) start() {
	safego.RunWithRestart(func() {
		for {
			if sw.streamingStorage.IsStaging() {
				break
			}
			if sw.closed.Load() {
				break
			}

			fact, dequeuedTime, tokenID, retriesCount, err := sw.eventQueue.DequeueBlock()
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
				sw.eventQueue.ConsumeTimed(fact, dequeuedTime, tokenID, retriesCount)
				continue
			}
			_, recognizedEvent := fact[schema.JitsuUserRecognizedEvent]
			if recognizedEvent && !sw.streamingStorage.GetUsersRecognition().IsEnabled() {
				//skip recognized event for storages with disabled/not supported UR
				continue
			}

			//is used in writing counters/metrics/events cache
			preliminaryEventContext := &adapters.EventContext{
				CacheDisabled:   sw.streamingStorage.IsCachingDisabled(),
				DestinationID:   sw.streamingStorage.ID(),
				EventID:         sw.streamingStorage.GetUniqueIDField().Extract(fact),
				TokenID:         tokenID,
				Src:             events.ExtractSrc(fact),
				RawEvent:        fact,
				RecognizedEvent: recognizedEvent,
			}

			envelops, err := sw.streamingStorage.Processor().ProcessEvent(fact, true)
			if err != nil && !recognizedEvent {
				if err == schema.ErrSkipObject {
					if !appconfig.Instance.DisableSkipEventsWarn {
						logging.Warnf("[%s] Event [%s]: %v", sw.streamingStorage.ID(), sw.streamingStorage.GetUniqueIDField().Extract(fact), err)
					}

					sw.streamingStorage.SkipEvent(preliminaryEventContext, err)
				} else {
					logging.Debugf("[%s] Unable to process object %s: %v", sw.streamingStorage.ID(), fact.DebugString(), err)
					sw.streamingStorage.ErrorEvent(true, preliminaryEventContext, err)
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
				var table *adapters.Table
				tableHelper := sw.getTableHelper()
				if tableHelper != nil {
					table = tableHelper.MapTableSchema(batchHeader)
				}
				eventContext := &adapters.EventContext{
					CacheDisabled: sw.streamingStorage.IsCachingDisabled(),
					DestinationID: sw.streamingStorage.ID(),
					EventID: utils.NvlString(sw.streamingStorage.GetUniqueIDField().Extract(flattenObject),
						sw.streamingStorage.GetUniqueIDField().Extract(fact)),
					TokenID:         tokenID,
					Src:             events.ExtractSrc(fact),
					RawEvent:        fact,
					ProcessedEvent:  flattenObject,
					Table:           table,
					RecognizedEvent: recognizedEvent,
				}
				if recognizedEvent {
					if updateErr := sw.streamingStorage.Update(eventContext); updateErr != nil {
						err := errorj.Decorate(updateErr, "failed to update event").
							WithProperty(errorj.DestinationID, sw.streamingStorage.ID()).
							WithProperty(errorj.DestinationType, sw.streamingStorage.Type())

						var retryInfoInLog string
						var delay time.Duration
						retry := IsConnectionError(updateErr) && retriesCount < 4
						if retry {
							delay = time.Duration(math.Pow10(retriesCount)) * time.Minute
							retryInfoInLog = fmt.Sprintf("connection problem. event will be re-updated after %s. (retry: %d)\n", delay.String(), retriesCount)
						}
						if errorj.IsSystemError(err) {
							logging.SystemErrorf("%+v\n%sorigin event: %s", err, retryInfoInLog, flattenObject.DebugString())
						} else {
							logging.Errorf("%+v\n%sorigin event: %s", err, retryInfoInLog, flattenObject.DebugString())
						}

						if retry {
							//retry
							sw.eventQueue.ConsumeTimed(fact, timestamp.Now().Add(delay), tokenID, retriesCount+1)
						}
					}
				} else {
					if insertErr := sw.streamingStorage.Insert(eventContext); insertErr != nil {
						err := errorj.Decorate(insertErr, "failed to insert event").
							WithProperty(errorj.DestinationID, sw.streamingStorage.ID()).
							WithProperty(errorj.DestinationType, sw.streamingStorage.Type())

						var retryInfoInLog string
						var delay time.Duration
						retry := IsConnectionError(insertErr) && retriesCount < 4
						if retry {
							delay = time.Duration(math.Pow10(retriesCount)) * time.Minute
							retryInfoInLog = fmt.Sprintf("connection problem. event will be re-inserted after %s. (retry: %d)\n", delay.String(), retriesCount)
						}
						if errorj.IsSystemError(err) {
							logging.SystemErrorf("%+v\n%sorigin event: %s", err, retryInfoInLog, flattenObject.DebugString())
						} else if logging.LogLevel == logging.DEBUG {
							logging.Debugf("%+v\n%sorigin event: %s", err, retryInfoInLog, flattenObject.DebugString())
						}

						if retry {
							//retry
							sw.eventQueue.ConsumeTimed(fact, timestamp.Now().Add(delay), tokenID, retriesCount+1)
						}
					}
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
	length := len(sw.tableHelper)
	if length == 0 {
		return nil
	}
	num := rand.Intn(length)
	return sw.tableHelper[num]
}
