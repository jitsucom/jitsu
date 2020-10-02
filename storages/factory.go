package storages

import (
	"context"
	"errors"
	"fmt"
	"github.com/ksensehq/eventnative/adapters"
	"github.com/ksensehq/eventnative/appconfig"
	"github.com/ksensehq/eventnative/events"
	"github.com/ksensehq/eventnative/logging"
	"github.com/ksensehq/eventnative/schema"
)

const (
	defaultTableName = "events"

	BatchMode  = "batch"
	StreamMode = "stream"
)

var unknownDestination = errors.New("Unknown destination type")

type DestinationConfig struct {
	OnlyTokens   []string    `mapstructure:"only_tokens" json:"only_tokens,omitempty"`
	Type         string      `mapstructure:"type" json:"type,omitempty"`
	Mode         string      `mapstructure:"mode" json:"mode,omitempty"`
	DataLayout   *DataLayout `mapstructure:"data_layout" json:"data_layout,omitempty"`
	BreakOnError bool        `mapstructure:"break_on_error" json:"break_on_error,omitempty"`

	DataSource *adapters.DataSourceConfig `mapstructure:"datasource" json:"datasource,omitempty"`
	S3         *adapters.S3Config         `mapstructure:"s3" json:"s3,omitempty"`
	Google     *adapters.GoogleConfig     `mapstructure:"google" json:"google,omitempty"`
	ClickHouse *adapters.ClickHouseConfig `mapstructure:"clickhouse" json:"clickhouse,omitempty"`
	Snowflake  *adapters.SnowflakeConfig  `mapstructure:"snowflake" json:"snowflake,omitempty"`
}

type DataLayout struct {
	Mapping           []string `mapstructure:"mapping" json:"mapping,omitempty"`
	TableNameTemplate string   `mapstructure:"table_name_template" json:"table_name_template,omitempty"`
}

type Config struct {
	ctx           context.Context
	name          string
	destination   *DestinationConfig
	processor     *schema.Processor
	streamMode    bool
	monitorKeeper MonitorKeeper
	eventQueue    *events.PersistentQueue
}

//Create event storage proxy and event consumer (logger or event-queue)
//Enrich incoming configs with default values if needed
func Create(ctx context.Context, name, logEventPath string, destination DestinationConfig, monitorKeeper MonitorKeeper) (events.StorageProxy, *events.PersistentQueue, error) {
	if destination.Type == "" {
		destination.Type = name
	}
	if destination.Mode == "" {
		destination.Mode = BatchMode
	}

	var mapping []string
	var tableName string
	if destination.DataLayout != nil {
		mapping = destination.DataLayout.Mapping

		if destination.DataLayout.TableNameTemplate != "" {
			tableName = destination.DataLayout.TableNameTemplate
		}
	}

	logging.Infof("[%s] Initializing destination of type: %s in mode: %s", name, destination.Type, destination.Mode)

	if tableName == "" {
		tableName = defaultTableName
		logging.Infof("[%s] uses default table name: %s", name, tableName)
	}

	if len(mapping) == 0 {
		logging.Warnf("[%s] doesn't have mapping rules", name)
	} else {
		logging.Infof("[%s] Configured field mapping rules:", name)
		for _, m := range mapping {
			logging.Infof("[%s] %s", name, m)
		}
	}

	if destination.Mode != BatchMode && destination.Mode != StreamMode {
		return nil, nil, fmt.Errorf("Unknown destination mode: %s. Available mode: [%s, %s]", destination.Mode, BatchMode, StreamMode)
	}

	processor, err := schema.NewProcessor(tableName, mapping)
	if err != nil {
		return nil, nil, err
	}

	var eventQueue *events.PersistentQueue
	if destination.Mode == StreamMode {
		queueName := fmt.Sprintf("%s-%s", appconfig.Instance.ServerName, name)
		eventQueue, err = events.NewPersistentQueue(queueName, logEventPath)
		if err != nil {
			return nil, nil, err
		}
	}

	storageConfig := &Config{
		ctx:           ctx,
		name:          name,
		destination:   &destination,
		processor:     processor,
		streamMode:    destination.Mode == StreamMode,
		monitorKeeper: monitorKeeper,
		eventQueue:    eventQueue,
	}

	var storageProxy events.StorageProxy
	switch destination.Type {
	case "redshift":
		storageProxy = newProxy(createRedshift, storageConfig)
	case "bigquery":
		storageProxy = newProxy(createBigQuery, storageConfig)
	case "postgres":
		storageProxy = newProxy(createPostgres, storageConfig)
	case "clickhouse":
		storageProxy = newProxy(createClickHouse, storageConfig)
	case "s3":
		storageProxy = newProxy(createS3, storageConfig)
	case "snowflake":
		storageProxy = newProxy(createSnowflake, storageConfig)
	default:
		if eventQueue != nil {
			eventQueue.Close()
		}
		return nil, nil, unknownDestination
	}

	return storageProxy, eventQueue, nil
}

func logError(destinationName, destinationType string, err error) {
	logging.Errorf("[%s] Error initializing destination of type %s: %v", destinationName, destinationType, err)
}

//Create aws Redshift destination
func createRedshift(config *Config) (events.Storage, error) {
	redshiftConfig := config.destination.DataSource
	if err := redshiftConfig.Validate(); err != nil {
		return nil, err
	}
	//enrich with default parameters
	if redshiftConfig.Port <= 0 {
		redshiftConfig.Port = 5439
		logging.Warnf("[%s] port wasn't provided. Will be used default one: %d", config.name, redshiftConfig.Port)
	}
	if redshiftConfig.Schema == "" {
		redshiftConfig.Schema = "public"
		logging.Warnf("[%s] schema wasn't provided. Will be used default one: %s", config.name, redshiftConfig.Schema)
	}
	//default connect timeout seconds
	if _, ok := redshiftConfig.Parameters["connect_timeout"]; !ok {
		redshiftConfig.Parameters["connect_timeout"] = "600"
	}

	return NewAwsRedshift(config.ctx, config.name, config.eventQueue, config.destination.S3, redshiftConfig, config.processor, config.destination.BreakOnError, config.streamMode, config.monitorKeeper)
}

//Create google BigQuery destination
func createBigQuery(config *Config) (events.Storage, error) {
	gConfig := config.destination.Google
	if err := gConfig.Validate(config.streamMode); err != nil {
		return nil, err
	}

	if gConfig.Project == "" {
		return nil, errors.New("BigQuery project(bq_project) is required parameter")
	}

	//enrich with default parameters
	if gConfig.Dataset == "" {
		gConfig.Dataset = "default"
		logging.Warnf("[%s] dataset wasn't provided. Will be used default one: %s", config.name, gConfig.Dataset)
	}

	return NewBigQuery(config.ctx, config.name, config.eventQueue, gConfig, config.processor, config.destination.BreakOnError, config.streamMode, config.monitorKeeper)
}

//Create Postgres destination
func createPostgres(config *Config) (events.Storage, error) {
	pgConfig := config.destination.DataSource
	if err := pgConfig.Validate(); err != nil {
		return nil, err
	}
	//enrich with default parameters
	if pgConfig.Port <= 0 {
		pgConfig.Port = 5432
		logging.Warnf("[%s] port wasn't provided. Will be used default one: %d", config.name, pgConfig.Port)
	}
	if pgConfig.Schema == "" {
		pgConfig.Schema = "public"
		logging.Warnf("[%s] schema wasn't provided. Will be used default one: %s", config.name, pgConfig.Schema)
	}
	//default connect timeout seconds
	if _, ok := pgConfig.Parameters["connect_timeout"]; !ok {
		pgConfig.Parameters["connect_timeout"] = "600"
	}

	return NewPostgres(config.ctx, pgConfig, config.processor, config.eventQueue, config.name, config.destination.BreakOnError, config.streamMode, config.monitorKeeper)
}

//Create ClickHouse destination
func createClickHouse(config *Config) (events.Storage, error) {
	chConfig := config.destination.ClickHouse
	if err := chConfig.Validate(); err != nil {
		return nil, err
	}

	return NewClickHouse(config.ctx, config.name, config.eventQueue, chConfig, config.processor, config.destination.BreakOnError, config.streamMode, config.monitorKeeper)
}

//Create s3 destination
func createS3(config *Config) (events.Storage, error) {
	if config.streamMode {
		if config.eventQueue != nil {
			config.eventQueue.Close()
		}
		return nil, fmt.Errorf("S3 destination doesn't support %s mode", StreamMode)
	}
	s3Config := config.destination.S3
	if err := s3Config.Validate(); err != nil {
		return nil, err
	}

	return NewS3(config.name, s3Config, config.processor, config.destination.BreakOnError)
}

//Create Snowflake destination
func createSnowflake(config *Config) (events.Storage, error) {
	snowflakeConfig := config.destination.Snowflake
	if err := snowflakeConfig.Validate(); err != nil {
		return nil, err
	}
	if snowflakeConfig.Schema == "" {
		snowflakeConfig.Schema = "PUBLIC"
		logging.Warnf("[%s] schema wasn't provided. Will be used default one: %s", config.name, snowflakeConfig.Schema)
	}

	//default client_session_keep_alive
	if _, ok := snowflakeConfig.Parameters["client_session_keep_alive"]; !ok {
		t := "true"
		snowflakeConfig.Parameters["client_session_keep_alive"] = &t
	}

	if config.destination.Google != nil {
		if err := config.destination.Google.Validate(config.streamMode); err != nil {
			return nil, err
		}
		//stage is required when gcp integration
		if snowflakeConfig.Stage == "" {
			return nil, errors.New("Snowflake stage is required parameter in GCP integration")
		}
	}

	return NewSnowflake(config.ctx, config.name, config.eventQueue, config.destination.S3, config.destination.Google, snowflakeConfig, config.processor, config.destination.BreakOnError, config.streamMode, config.monitorKeeper)
}
