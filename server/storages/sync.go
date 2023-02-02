package storages

import (
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/errorj"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/schema"
	"github.com/jitsucom/jitsu/server/utils"
	"go.uber.org/atomic"
	"math/rand"
)

// SyncStorage supports ProcessEvent synchronous operation
type SyncStorage interface {
	Storage
	//ProcessEvent process event in sync fashion. Return resulting object immediately
	ProcessEvent(eventContext *adapters.EventContext) (map[string]interface{}, error)
	//SuccessEvent writes metrics/counters/events cache, etc
	SuccessEvent(eventCtx *adapters.EventContext)
	//ErrorEvent writes metrics/counters/events cache, etc
	ErrorEvent(fallback bool, eventCtx *adapters.EventContext, err error)
	//SkipEvent writes metrics/counters/events cache, etc
	SkipEvent(eventCtx *adapters.EventContext, err error)
}

// SyncWorker process events synchronously. Allow returning result of processing in the body of http response
type SyncWorker struct {
	syncStorage SyncStorage
	tableHelper []*TableHelper

	closed *atomic.Bool
}

// newSyncWorker returns configured sync worker
func newSyncWorker(syncStorage SyncStorage, tableHelper ...*TableHelper) *SyncWorker {
	return &SyncWorker{
		syncStorage: syncStorage,
		tableHelper: tableHelper,
		closed:      atomic.NewBool(false),
	}
}

func (sw *SyncWorker) ProcessEvent(fact events.Event, tokenID string) []map[string]interface{} {
	if sw.syncStorage.IsStaging() {
		return nil
	}
	if sw.closed.Load() {
		return nil
	}

	_, recognizedEvent := fact[schema.JitsuUserRecognizedEvent]
	if recognizedEvent {
		//User Recognition not supported for SyncStorage
		return nil
	}

	//is used in writing counters/metrics/events cache
	preliminaryEventContext := &adapters.EventContext{
		CacheDisabled:   sw.syncStorage.IsCachingDisabled(),
		DestinationID:   sw.syncStorage.ID(),
		EventID:         sw.syncStorage.GetUniqueIDField().Extract(fact),
		TokenID:         tokenID,
		Src:             events.ExtractSrc(fact),
		RawEvent:        fact,
		RecognizedEvent: recognizedEvent,
	}

	envelops, err := sw.syncStorage.Processor().ProcessEvent(fact, true)
	if err != nil && !recognizedEvent {
		if err == schema.ErrSkipObject {
			if !appconfig.Instance.DisableSkipEventsWarn {
				logging.Warnf("[%s] Event [%s]: %v", sw.syncStorage.ID(), sw.syncStorage.GetUniqueIDField().Extract(fact), err)
			}

			sw.syncStorage.SkipEvent(preliminaryEventContext, err)
		} else {
			logging.Debugf("[%s] Unable to process object %s: %v", sw.syncStorage.ID(), fact.DebugString(), err)
			sw.syncStorage.ErrorEvent(true, preliminaryEventContext, err)
		}

		return nil
	}
	results := make([]map[string]interface{}, 0, len(envelops))
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
			CacheDisabled: sw.syncStorage.IsCachingDisabled(),
			DestinationID: sw.syncStorage.ID(),
			EventID: utils.NvlString(sw.syncStorage.GetUniqueIDField().Extract(flattenObject),
				sw.syncStorage.GetUniqueIDField().Extract(fact)),
			TokenID:         tokenID,
			Src:             events.ExtractSrc(fact),
			RawEvent:        fact,
			ProcessedEvent:  flattenObject,
			Table:           table,
			RecognizedEvent: recognizedEvent,
		}
		result, err := sw.syncStorage.ProcessEvent(eventContext)
		if err != nil {
			err := errorj.Decorate(err, "failed to process event").
				WithProperty(errorj.DestinationID, sw.syncStorage.ID()).
				WithProperty(errorj.DestinationType, sw.syncStorage.Type())

			if errorj.IsSystemError(err) {
				logging.SystemErrorf("%+v\norigin event: %s", err, flattenObject.DebugString())
			} else {
				logging.Errorf("%+v\norigin event: %s", err, flattenObject.DebugString())
			}
			sw.syncStorage.ErrorEvent(true, eventContext, err)
		} else {
			results = append(results, result)
			sw.syncStorage.SuccessEvent(eventContext)
		}
	}
	return results
}

func (sw *SyncWorker) Close() error {
	sw.closed.Store(true)

	return nil
}

func (sw *SyncWorker) getTableHelper() *TableHelper {
	length := len(sw.tableHelper)
	if length == 0 {
		return nil
	}
	num := rand.Intn(length)
	return sw.tableHelper[num]
}
