package storages

import (
	"errors"
	"fmt"
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/schema"
)

//Kafka stores events to Confluent Kafka in stream mode
type Kafka struct {
	Abstract

	kafkaAdapter *adapters.Kafka
}

func init() {
	RegisterStorage(KafkaType, NewS3)
}

func NewKafka(config *Config) (Storage, error) {
	kafkaConfig := config.destination.Kafka
	if err := kafkaConfig.Validate(); err != nil {
		return nil, err
	}

	kafkaAdapter, err := adapters.NewKafka(kafkaConfig)
	if err != nil {
		return nil, err
	}

	kafka := &Kafka{
		kafkaAdapter: kafkaAdapter,
	}

	//Abstract (SQLAdapters and tableHelpers and archive logger are omitted)
	kafka.destinationID = config.destinationID
	kafka.processor = config.processor
	kafka.fallbackLogger = config.loggerFactory.CreateFailedLogger(config.destinationID)
	kafka.eventsCache = config.eventsCache
	kafka.uniqueIDField = config.uniqueIDField
	kafka.staged = config.destination.Staged
	kafka.cachingConfiguration = config.destination.CachingConfiguration

	return kafka, nil
}

func (k *Kafka) Store(fileName string, objects []map[string]interface{}, alreadyUploadedTables map[string]bool) (map[string]*StoreResult, *events.FailedEvents, error) {
	panic("implement me")
}

func (k *Kafka) SyncStore(overriddenDataSchema *schema.BatchHeader, objects []map[string]interface{}, timeIntervalValue string, cacheTable bool) error {
	panic("implement me")
}

func (k *Kafka) Update(object map[string]interface{}) error {
	return errors.New("kafka doesn't support updates")
}

func (k *Kafka) GetUsersRecognition() *UserRecognitionConfiguration {
	return disabledRecognitionConfiguration
}

func (k *Kafka) Type() string {
	return KafkaType
}

//Close closes adapter and abstract storage
func (k *Kafka) Close() (multiErr error) {
	if err := k.kafkaAdapter.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing kafka adapter: %v", k.ID(), err))
	}
	if err := k.close(); err != nil {
		multiErr = multierror.Append(multiErr, err)
	}
	return
}
