package adapters

import (
	"errors"
	"github.com/Shopify/sarama"
	"github.com/jitsucom/jitsu/server/schema"
	"time"
)

//Kafka is a Kafka adapter for producing messages
type Kafka struct {
	config         *KafkaConfig
	saramaConfig   *sarama.Config
	producer       sarama.SyncProducer
	jsonMarshaller schema.Marshaller
}

//KafkaConfig is a dto for config deserialization
type KafkaConfig struct {
	BootstrapServers []string `mapstructure:"bootstrap_servers" json:"bootstrap_servers,omitempty" yaml:"bootstrap_servers,omitempty"`
}

//Validate returns err if invalid
func (kc *KafkaConfig) Validate() error {
	if kc == nil {
		return errors.New("kafka config is required")
	}
	if len(kc.BootstrapServers) == 0 {
		return errors.New("kafka bootstrap_servers is required")
	}
	for _, server := range kc.BootstrapServers {
		if server == "" {
			return errors.New("boostrap server must be nonempty string")
		}
	}
	return nil
}

//NewKafka returns configured Kafka adapter
func NewKafka(kc *KafkaConfig) (*Kafka, error) {
	if err := kc.Validate(); err != nil {
		return nil, err
	}

	saramaConfig := sarama.NewConfig()
	saramaConfig.Producer.RequiredAcks = sarama.WaitForAll
	saramaConfig.Producer.Retry.Max = 20
	saramaConfig.Producer.Retry.Backoff = 500 * time.Millisecond
	saramaConfig.Producer.Return.Successes = true
	producer, err := sarama.NewSyncProducer(kc.BootstrapServers, saramaConfig)
	if err != nil {
		return nil, err
	}
	return &Kafka{config: kc, saramaConfig: saramaConfig, producer: producer, jsonMarshaller: schema.JSONMarshallerInstance}, nil
}

//Type returns adapter type
func (*Kafka) Type() string {
	return "Kafka"
}

//Close closes Kafka producer
func (k *Kafka) Close() error {
	return k.producer.Close()
}

//Insert produces message
func (k *Kafka) Insert(event *EventContext) error {
	return k.sendEvent(event)
}

func (k *Kafka) BulkInsert(table *Table, objects []map[string]interface{}) error {
	return k.sendObjects(table.Name, objects)
}

func (k *Kafka) BulkUpdate(table *Table, objects []map[string]interface{}, _ *DeleteConditions) error {
	return k.sendObjects(table.Name, objects)
}

//GetTableSchema always returns empty table
func (k *Kafka) GetTableSchema(tableName string) (*Table, error) {
	return &Table{
		Name:           tableName,
		Columns:        Columns{},
		PKFields:       map[string]bool{},
		DeletePkFields: false,
		Version:        0,
	}, nil
}

//CreateTable empty implementation
func (k *Kafka) CreateTable(*Table) error {
	return nil
}

//PatchTableSchema empty implementation
func (k *Kafka) PatchTableSchema(*Table) error {
	return nil
}

func (k *Kafka) sendEvent(event *EventContext) error {
	msg := &sarama.ProducerMessage{
		Topic: event.Table.Name,
		Value: sarama.StringEncoder(event.ProcessedEvent.Serialize()),
	}
	if _, _, err := k.producer.SendMessage(msg); err != nil {
		return err
	}
	return nil
}

func (k *Kafka) sendObjects(topic string, objects []map[string]interface{}) error {
	var noFields []string
	for _, obj := range objects {
		bytes, err := k.jsonMarshaller.Marshal(noFields, obj)
		if err != nil {
			return err
		}
		msg := &sarama.ProducerMessage{
			Topic: topic,
			Value: sarama.ByteEncoder(bytes),
		}
		if _, _, err := k.producer.SendMessage(msg); err != nil {
			return err
		}
	}
	return nil
}

//Truncate empty implementation
func (k *Kafka) Truncate(string) error {
	return nil
}
