package adapters

import (
	"crypto/tls"
	"errors"
	"fmt"
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
	BootstrapServers []string  `mapstructure:"bootstrap_servers" json:"bootstrap_servers,omitempty" yaml:"bootstrap_servers,omitempty"`
	Topic            string    `mapstructure:"topic" json:"topic,omitempty" yaml:"topic,omitempty"`
	DisableTLS       bool      `mapstructure:"disable_tls" json:"disable_tls,omitempty" yaml:"disable_tls,omitempty"`
	AuthType         KafkaAuth `mapstructure:"auth_type" json:"auth_type,omitempty" yaml:"auth_type,omitempty"`
	Username         string    `mapstructure:"username" json:"username,omitempty" yaml:"username,omitempty"`
	Password         string    `mapstructure:"password" json:"password,omitempty" yaml:"password,omitempty"`
}

type KafkaAuth string

const (
	KafkaAuthNone         KafkaAuth = "none"
	KafkaAuthSAMLPLAIN    KafkaAuth = "saml_plain"
	KafkaAuthSAMLSCRAM256 KafkaAuth = "saml_scram_256"
	KafkaAuthSAMLSCRAM512 KafkaAuth = "saml_scram_512"
)

//Validate returns error if invalid
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
	if kc.Topic == "" {
		return errors.New("topic is required parameter")
	}
	if kc.AuthType != KafkaAuthNone {
		if kc.Username == "" {
			return errors.New(fmt.Sprintf("username is required parameter for auth_type = %s", kc.AuthType))
		}
		if kc.Password == "" {
			return errors.New(fmt.Sprintf("password is required parameter for auth_type = %s", kc.AuthType))
		}
	}
	return nil
}

//NewKafka returns configured Kafka adapter
func NewKafka(kc *KafkaConfig) (*Kafka, error) {
	if kc.AuthType == "" {
		kc.AuthType = KafkaAuthNone
	}
	if err := kc.Validate(); err != nil {
		return nil, err
	}

	saramaConfig := sarama.NewConfig()
	saramaConfig.ClientID = "jitsu_kafka_adapter"
	saramaConfig.Producer.RequiredAcks = sarama.WaitForAll
	saramaConfig.Producer.Retry.Max = 20
	saramaConfig.Producer.Retry.Backoff = 500 * time.Millisecond
	saramaConfig.Producer.Return.Successes = true

	if !kc.DisableTLS {
		saramaConfig.Net.TLS.Enable = true
		saramaConfig.Net.TLS.Config = &tls.Config{
			InsecureSkipVerify: true,
			//TODO load real certs
			//RootCAs:            certs,
		}
	}
	if kc.AuthType != KafkaAuthNone {
		// common SASL auth code here
		saramaConfig.Net.SASL.Enable = true
		saramaConfig.Net.SASL.Handshake = true
		saramaConfig.Net.SASL.User = kc.Username
		saramaConfig.Net.SASL.Password = kc.Password

		switch kc.AuthType {
		case KafkaAuthSAMLPLAIN:
			saramaConfig.Net.SASL.Mechanism = sarama.SASLTypePlaintext
		case KafkaAuthSAMLSCRAM256:
			saramaConfig.Net.SASL.Mechanism = sarama.SASLTypeSCRAMSHA256
			saramaConfig.Net.SASL.SCRAMClientGeneratorFunc = func() sarama.SCRAMClient { return &XDGSCRAMClient{HashGeneratorFcn: SHA256} }
		case KafkaAuthSAMLSCRAM512:
			saramaConfig.Net.SASL.Mechanism = sarama.SASLTypeSCRAMSHA512
			saramaConfig.Net.SASL.SCRAMClientGeneratorFunc = func() sarama.SCRAMClient { return &XDGSCRAMClient{HashGeneratorFcn: SHA512} }
		}
	}

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

func (k *Kafka) BulkInsert(_ *Table, objects []map[string]interface{}) error {
	return k.sendObjects(k.config.Topic, objects)
}

func (k *Kafka) BulkUpdate(_ *Table, objects []map[string]interface{}, _ *DeleteConditions) error {
	return k.sendObjects(k.config.Topic, objects)
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
		Topic: k.config.Topic,
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
