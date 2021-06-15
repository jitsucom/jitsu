package storages

import (
	"context"
	"fmt"
	"math/rand"
	"strings"
	"time"

	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/caching"
	"github.com/jitsucom/jitsu/server/coordination"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	"github.com/jitsucom/jitsu/server/schema"
	"github.com/jitsucom/jitsu/server/timestamp"
)

func dryRun(payload events.Event, processor *schema.Processor, tableHelper *TableHelper) ([]adapters.TableField, error) {
	batchHeader, event, err := processor.ProcessEvent(payload)
	if err != nil {
		return nil, err
	}

	tableSchema := tableHelper.MapTableSchema(batchHeader)
	var dryRunResponses []adapters.TableField

	for name, column := range tableSchema.Columns {
		dryRunResponses = append(dryRunResponses, adapters.TableField{Field: name, Type: column.SQLType, Value: event[name]})
	}

	return dryRunResponses, nil
}

func isConnectionError(err error) bool {
	return strings.Contains(err.Error(), "connection refused") ||
		strings.Contains(err.Error(), "EOF") ||
		strings.Contains(err.Error(), "write: broken pipe") ||
		strings.Contains(err.Error(), "context deadline exceeded") ||
		strings.Contains(err.Error(), "connection reset by peer") ||
		strings.Contains(err.Error(), "write: connection timed out")
}

func TestBatchProcessing(config *DestinationConfig) error {
	if config.Mode == StreamMode {
		return nil
	}

	ctx := context.Background()

	monitor := coordination.NewInMemoryService([]string{})
	defer monitor.Close()

	metaStorage, _ := meta.NewStorage(nil)
	defer metaStorage.Close()

	eventsCache := caching.NewEventsCache(metaStorage, 100)
	defer eventsCache.Close()

	factory := NewFactory(ctx, "/tmp", monitor, eventsCache, nil, nil, metaStorage, 0)

	randomValue := rand.Intn(1000000)
	testName := fmt.Sprintf("jitsu_test_connection_%v_%06v", time.Now().Format(timestamp.DayLayout), randomValue)
	config.DataLayout = &DataLayout{
		TableNameTemplate: testName,
		UniqueIDField:     "id",
	}
	config.CachingConfiguration = &CachingConfiguration{
		Disabled: true,
	}

	storageProxy, eventQueue, err := factory.Create(testName, *config)
	if err != nil {
		logging.Errorf("[%s] Error initializing destination of type '%s': %v", testName, config.Type, err)
		return err
	}

	defer eventQueue.Close()
	defer storageProxy.Close()

	storage, err := storageProxy.Create()
	if err != nil {
		return err
	}

	defer storage.Close()

	event := map[string]interface{}{
		"id":    randomValue,
		"field": testName,
	}
	events := []map[string]interface{}{
		event,
	}

	stageAdapter := storage.getStageAdapter()

	defer func() {
		if stageAdapter != nil {
			stageAdapter.DeleteObject(testName)
		}
	}()

	table := &adapters.Table{
		Name: testName,
	}

	adapter, _ := storage.getAdapters()

	defer func() {
		if err := adapter.DeleteTable(table); err != nil {
			// Suppressing error because we need to check only write permission
			logging.Warnf("Cannot remove table [%s] from '%v': %v", testName, storage.Type(), err)
		}
	}()

	alreadyUploadedTables := map[string]bool{}
	_, _, err = storage.Store(testName, events, alreadyUploadedTables)
	if err != nil {
		return err
	}

	return nil
}

func TestStreamProcessing(config *DestinationConfig) error {
	if config.Mode != StreamMode {
		return nil
	}

	ctx := context.Background()

	monitor := coordination.NewInMemoryService([]string{})
	defer monitor.Close()

	metaStorage, _ := meta.NewStorage(nil)
	defer metaStorage.Close()

	eventsCache := caching.NewEventsCache(metaStorage, 100)
	defer eventsCache.Close()

	factory := NewFactory(ctx, "/tmp", monitor, eventsCache, nil, nil, metaStorage, 0)

	randomValue := rand.Intn(1000000)
	testName := fmt.Sprintf("jitsu_test_connection_%v_%06v", time.Now().Format(timestamp.DayLayout), randomValue)
	config.DataLayout = &DataLayout{
		TableNameTemplate: testName,
		UniqueIDField:     "id",
	}
	config.CachingConfiguration = &CachingConfiguration{
		Disabled: true,
	}

	storageProxy, eventQueue, err := factory.Create(testName, *config)
	if err != nil {
		logging.Errorf("[%s] Error initializing destination of type %s: %v", testName, config.Type, err)
		return err
	}

	defer eventQueue.Close()
	defer storageProxy.Close()

	storage, err := storageProxy.Create()
	if err != nil {
		return err
	}

	defer storage.Close()

	event := map[string]interface{}{
		"id":    randomValue,
		"field": testName,
	}

	processor := storage.Processor()
	if processor == nil {
		return fmt.Errorf("Storage of '%v' type was badly configured", storage.Type())
	}

	batchHeader, processedEvent, err := processor.ProcessEvent(event)
	if err != nil {
		return err
	}

	if !batchHeader.Exists() {
		return nil
	}

	adapter, tableHelper := storage.getAdapters()

	table := tableHelper.MapTableSchema(batchHeader)

	if _, err := tableHelper.EnsureTable(storage.ID(), table, false); err != nil {
		return err
	}

	defer func() {
		if err := adapter.DeleteTable(table); err != nil {
			// Suppressing error because we need to check only write permission
			logging.Warnf("Cannot remove table [%s] from '%v': %v", testName, storage.Type(), err)
		}
	}()

	eventContext := &adapters.EventContext{
		RawEvent:       event,
		ProcessedEvent: processedEvent,
		Table:          table,
	}

	if err = adapter.Insert(eventContext); err != nil {
		return err
	}

	return nil
}
