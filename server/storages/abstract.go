package storages

import (
	"fmt"
	"github.com/jitsucom/jitsu/server/identifiers"
	"math/rand"

	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/caching"
	"github.com/jitsucom/jitsu/server/counters"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/metrics"
	"github.com/jitsucom/jitsu/server/schema"
	"github.com/jitsucom/jitsu/server/telemetry"
)

//Abstract is an Abstract destination storage
//contains common destination funcs
//aka abstract class
type Abstract struct {
	destinationID  string
	fallbackLogger *logging.AsyncLogger
	eventsCache    *caching.EventsCache
	processor      *schema.Processor

	tableHelpers []*TableHelper
	sqlAdapters  []adapters.SQLAdapter

	uniqueIDField        *identifiers.UniqueID
	staged               bool
	cachingConfiguration *CachingConfiguration

	archiveLogger *logging.AsyncLogger
}

//ID returns destination ID
func (a *Abstract) ID() string {
	return a.destinationID
}

// Processor returns processor
func (a *Abstract) Processor() *schema.Processor {
	return a.processor
}

func (a *Abstract) IsStaging() bool {
	return a.staged
}

//GetUniqueIDField returns unique ID field configuration
func (a *Abstract) GetUniqueIDField() *identifiers.UniqueID {
	return a.uniqueIDField
}

//IsCachingDisabled returns true if caching is disabled in destination configuration
func (a *Abstract) IsCachingDisabled() bool {
	return a.cachingConfiguration != nil && a.cachingConfiguration.Disabled
}

func (a *Abstract) DryRun(payload events.Event) ([]adapters.TableField, error) {
	_, tableHelper := a.getAdapters()
	return dryRun(payload, a.processor, tableHelper)
}

//ErrorEvent writes error to metrics/counters/telemetry/events cache
func (a *Abstract) ErrorEvent(fallback bool, eventCtx *adapters.EventContext, err error) {
	metrics.ErrorTokenEvent(eventCtx.TokenID, a.destinationID)
	counters.ErrorEvents(a.destinationID, 1)
	telemetry.Error(eventCtx.TokenID, a.destinationID, eventCtx.Src, 1)

	//cache
	a.eventsCache.Error(eventCtx.CacheDisabled, a.destinationID, eventCtx.EventID, err.Error())

	if fallback {
		a.Fallback(&events.FailedEvent{
			Event:   []byte(eventCtx.RawEvent.Serialize()),
			Error:   err.Error(),
			EventID: eventCtx.EventID,
		})
	}
}

//SuccessEvent writes success to metrics/counters/telemetry/events cache
func (a *Abstract) SuccessEvent(eventCtx *adapters.EventContext) {
	counters.SuccessEvents(a.destinationID, 1)
	telemetry.Event(eventCtx.TokenID, a.destinationID, eventCtx.Src, 1)
	metrics.SuccessTokenEvent(eventCtx.TokenID, a.destinationID)

	//cache
	a.eventsCache.Succeed(eventCtx.CacheDisabled, a.destinationID, eventCtx.EventID, eventCtx.ProcessedEvent, eventCtx.Table)
}

//SkipEvent writes skip to metrics/counters/telemetry and error to events cache
func (a *Abstract) SkipEvent(eventCtx *adapters.EventContext, err error) {
	counters.SkipEvents(a.destinationID, 1)
	metrics.SkipTokenEvent(eventCtx.TokenID, a.destinationID)

	//cache
	a.eventsCache.Error(eventCtx.CacheDisabled, a.destinationID, eventCtx.EventID, err.Error())
}

//Fallback logs event with error to fallback logger
func (a *Abstract) Fallback(failedEvents ...*events.FailedEvent) {
	for _, failedEvent := range failedEvents {
		a.fallbackLogger.ConsumeAny(failedEvent)
	}
}

//Insert ensues table and sends input event to Destination (with 1 retry if error)
func (a *Abstract) Insert(eventContext *adapters.EventContext) (insertErr error) {
	//metrics/counters/cache/fallback
	defer func() {
		a.AccountResult(eventContext, insertErr)
	}()

	sqlAdapter, tableHelper := a.getAdapters()

	dbSchemaFromObject := eventContext.Table

	dbTable, err := tableHelper.EnsureTableWithCaching(a.ID(), eventContext.Table)
	if err != nil {
		insertErr = err
		return err
	}

	eventContext.Table = dbTable

	err = sqlAdapter.Insert(eventContext)

	//renew current db schema and retry
	if err != nil {
		dbTable, err := tableHelper.RefreshTableSchema(a.ID(), dbSchemaFromObject)
		if err != nil {
			insertErr = err
			return err
		}

		dbTable, err = tableHelper.EnsureTableWithCaching(a.ID(), dbSchemaFromObject)
		if err != nil {
			insertErr = err
			return err
		}

		eventContext.Table = dbTable

		err = sqlAdapter.Insert(eventContext)
		if err != nil {
			insertErr = err
			return err
		}
	}

	//archive
	a.archiveLogger.Consume(eventContext.RawEvent, eventContext.TokenID)

	return nil
}

//AccountResult checks input error and calls ErrorEvent or SuccessEvent
func (a *Abstract) AccountResult(eventContext *adapters.EventContext, err error) {
	if err != nil {
		if isConnectionError(err) {
			a.ErrorEvent(false, eventContext, err)
		} else {
			a.ErrorEvent(true, eventContext, err)
		}
	} else {
		a.SuccessEvent(eventContext)
	}
}

func (a *Abstract) close() (multiErr error) {
	if err := a.fallbackLogger.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing fallback logger: %v", a.ID(), err))
	}

	if err := a.archiveLogger.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing archive logger: %v", a.ID(), err))
	}
	a.processor.Close()

	return nil
}

//assume that adapters quantity == tableHelpers quantity
func (a *Abstract) getAdapters() (adapters.SQLAdapter, *TableHelper) {
	num := rand.Intn(len(a.sqlAdapters))
	return a.sqlAdapters[num], a.tableHelpers[num]
}
