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
	if config.Mode != BatchMode {
		return nil
	}

	ctx := context.Background()

	monitor := coordination.NewInMemoryService([]string{})
	defer monitor.Close()

	metaStorage, _ := meta.NewStorage(nil)
	defer metaStorage.Close()

	eventsCache := caching.NewEventsCache(metaStorage, 100)
	defer eventsCache.Close()

	factory := NewFactory(ctx, "", monitor, eventsCache, nil, nil, metaStorage, 0)

	randomValue := rand.Int()
	testName := fmt.Sprintf("test_%v_%v", time.Now().Format(timestamp.DayLayout), randomValue)
	config.DataLayout = &DataLayout{
		TableNameTemplate: testName,
		UniqueIDField:     "id",
	}
	config.CachingConfiguration = &CachingConfiguration{
		Disabled: true,
	}

	storageProxy, _, err := factory.Create(testName, *config)
	if err != nil {
		logging.Errorf("[%s] Error initializing destination of type %s: %v", testName, config.Type, err)
		return err
	}

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

	if err = storage.TestBatchProcessing(testName, events); err != nil {
		return err
	}

	return nil
}
