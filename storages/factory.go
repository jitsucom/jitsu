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
	"github.com/spf13/viper"
)

const (
	defaultTableName = "events"

	batchMode  = "batch"
	streamMode = "stream"
)

type DestinationConfig struct {
	OnlyTokens   []string    `mapstructure:"only_tokens"`
	Type         string      `mapstructure:"type"`
	Mode         string      `mapstructure:"mode"`
	DataLayout   *DataLayout `mapstructure:"data_layout"`
	BreakOnError bool        `mapstructure:"break_on_error"`

	DataSource *adapters.DataSourceConfig `mapstructure:"datasource"`
	S3         *adapters.S3Config         `mapstructure:"s3"`
	Google     *adapters.GoogleConfig     `mapstructure:"google"`
	ClickHouse *adapters.ClickHouseConfig `mapstructure:"clickhouse"`
	Snowflake  *adapters.SnowflakeConfig  `mapstructure:"snowflake"`
}

type DataLayout struct {
	Mapping           []string `mapstructure:"mapping"`
	TableNameTemplate string   `mapstructure:"table_name_template"`
}

var unknownDestination = errors.New("Unknown destination type")

//Create event storages(batch) and consumers(stream) from incoming config
//Enrich incoming configs with default values if needed
func Create(ctx context.Context, destinations *viper.Viper, logEventPath string, monitorKeeper MonitorKeeper) (map[string][]events.Storage, map[string][]events.Consumer) {
	stores := map[string][]events.Storage{}
	consumers := map[string][]events.Consumer{}
	if destinations == nil {
		return stores, consumers
	}

	dc := map[string]DestinationConfig{}
	if err := destinations.Unmarshal(&dc); err != nil {
		logging.Error("Error initializing destinations: wrong config format: each destination must contains one key and config as a value e.g. destinations:\n  custom_name:\n      type: redshift ...", err)
		return stores, consumers
	}

	for name, destination := range dc {
		if destination.Type == "" {
			destination.Type = name
		}
		if destination.Mode == "" {
			destination.Mode = batchMode
		}
		logging.Info("Initializing", name, "destination of type:", destination.Type, "in mode:", destination.Mode)

		if destination.Mode != batchMode && destination.Mode != streamMode {
			logError(name, destination.Type, fmt.Errorf("Unknown destination mode: %s. Available mode: [%s, %s]", destination.Mode, batchMode, streamMode))
			continue
		}

		var mapping []string
		tableName := defaultTableName
		if destination.DataLayout != nil {
			mapping = destination.DataLayout.Mapping

			if destination.DataLayout.TableNameTemplate != "" {
				tableName = destination.DataLayout.TableNameTemplate
			}
		}

		processor, err := schema.NewProcessor(tableName, mapping)
		if err != nil {
			logError(name, destination.Type, err)
			continue
		}

		var storage events.Storage
		var consumer events.Consumer
		switch destination.Type {
		case "redshift":
			if destination.Mode == streamMode {
				consumer, err = createRedshift(ctx, name, logEventPath, &destination, processor, true, monitorKeeper)
			} else {
				storage, err = createRedshift(ctx, name, logEventPath, &destination, processor, false, monitorKeeper)
			}
		case "bigquery":
			if destination.Mode == streamMode {
				consumer, err = createBigQuery(ctx, name, logEventPath, &destination, processor, true, monitorKeeper)
			} else {
				storage, err = createBigQuery(ctx, name, logEventPath, &destination, processor, false, monitorKeeper)
			}
		case "postgres":
			if destination.Mode == streamMode {
				consumer, err = createPostgres(ctx, name, logEventPath, &destination, processor, true, monitorKeeper)
			} else {
				storage, err = createPostgres(ctx, name, logEventPath, &destination, processor, false, monitorKeeper)
			}
		case "clickhouse":
			if destination.Mode == streamMode {
				consumer, err = createClickHouse(ctx, name, logEventPath, &destination, processor, true, monitorKeeper)
			} else {
				storage, err = createClickHouse(ctx, name, logEventPath, &destination, processor, false, monitorKeeper)
			}
		case "s3":
			if destination.Mode == streamMode {
				err = fmt.Errorf("S3 destination doesn't support %s mode", streamMode)
			} else {
				storage, err = createS3(name, &destination, processor)
			}
		case "snowflake":
			if destination.Mode == streamMode {
				consumer, err = createSnowflake(ctx, name, logEventPath, &destination, processor, true, monitorKeeper)
			} else {
				storage, err = createSnowflake(ctx, name, logEventPath, &destination, processor, false, monitorKeeper)
			}
		default:
			err = unknownDestination
		}

		if err != nil {
			logError(name, destination.Type, err)
			continue
		}

		tokens := destination.OnlyTokens
		if len(tokens) == 0 {
			logging.Warnf("only_tokens wasn't provided. All tokens will be stored in %s %s destination", name, destination.Type)
			for token := range appconfig.Instance.AuthorizationService.GetAllTokens() {
				tokens = append(tokens, token)
			}
		}

		for _, token := range tokens {
			if storage != nil {
				stores[token] = append(stores[token], storage)
			}
			if consumer != nil {
				consumers[token] = append(consumers[token], consumer)
			}
		}

	}
	return stores, consumers
}

func logError(destinationName, destinationType string, err error) {
	logging.Errorf("Error initializing %s destination of type %s: %v", destinationName, destinationType, err)
}

//Create aws Redshift destination
func createRedshift(ctx context.Context, name, logEventPath string, destination *DestinationConfig, processor *schema.Processor, streamMode bool, keeper MonitorKeeper) (*AwsRedshift, error) {
	redshiftConfig := destination.DataSource
	if err := redshiftConfig.Validate(); err != nil {
		return nil, err
	}
	//enrich with default parameters
	if redshiftConfig.Port <= 0 {
		redshiftConfig.Port = 5439
		logging.Errorf("name: %s type: redshift port wasn't provided. Will be used default one: %d", name, redshiftConfig.Port)
	}
	if redshiftConfig.Schema == "" {
		redshiftConfig.Schema = "public"
		logging.Errorf("name: %s type: redshift schema wasn't provided. Will be used default one: %s", name, redshiftConfig.Schema)
	}
	//default connect timeout seconds
	if _, ok := redshiftConfig.Parameters["connect_timeout"]; !ok {
		redshiftConfig.Parameters["connect_timeout"] = "600"
	}

	return NewAwsRedshift(ctx, name, logEventPath, destination.S3, redshiftConfig, processor, destination.BreakOnError, streamMode, keeper)
}

//Create google BigQuery destination
func createBigQuery(ctx context.Context, name, logEventPath string, destination *DestinationConfig, processor *schema.Processor, streamMode bool, keeper MonitorKeeper) (*BigQuery, error) {
	gConfig := destination.Google
	if err := gConfig.Validate(streamMode); err != nil {
		return nil, err
	}

	if gConfig.Project == "" {
		return nil, errors.New("BigQuery project(bq_project) is required parameter")
	}

	//enrich with default parameters
	if gConfig.Dataset == "" {
		gConfig.Dataset = "default"
		logging.Errorf("name: %s type: bigquery dataset wasn't provided. Will be used default one: %s", name, gConfig.Dataset)
	}

	return NewBigQuery(ctx, name, logEventPath, gConfig, processor, destination.BreakOnError, streamMode, keeper)
}

//Create Postgres destination
func createPostgres(ctx context.Context, name, logEventPath string, destination *DestinationConfig, processor *schema.Processor, streamMode bool, monitorKeeper MonitorKeeper) (*Postgres, error) {
	config := destination.DataSource
	if err := config.Validate(); err != nil {
		return nil, err
	}
	//enrich with default parameters
	if config.Port <= 0 {
		config.Port = 5432
		logging.Errorf("name: %s type: postgres port wasn't provided. Will be used default one: %d", name, config.Port)
	}
	if config.Schema == "" {
		config.Schema = "public"
		logging.Errorf("name: %s type: postgres schema wasn't provided. Will be used default one: %s", name, config.Schema)
	}
	//default connect timeout seconds
	if _, ok := config.Parameters["connect_timeout"]; !ok {
		config.Parameters["connect_timeout"] = "600"
	}

	return NewPostgres(ctx, config, processor, logEventPath, name, destination.BreakOnError, streamMode, monitorKeeper)
}

//Create ClickHouse destination
func createClickHouse(ctx context.Context, name, logEventPath string, destination *DestinationConfig, processor *schema.Processor, streamMode bool, keeper MonitorKeeper) (*ClickHouse, error) {
	config := destination.ClickHouse
	if err := config.Validate(); err != nil {
		return nil, err
	}

	return NewClickHouse(ctx, name, logEventPath, config, processor, destination.BreakOnError, streamMode, keeper)
}

//Create s3 destination
func createS3(name string, destination *DestinationConfig, processor *schema.Processor) (*S3, error) {
	s3Config := destination.S3
	if err := s3Config.Validate(); err != nil {
		return nil, err
	}

	return NewS3(name, s3Config, processor, destination.BreakOnError)
}

//Create Snowflake destination
func createSnowflake(ctx context.Context, name, logEventPath string, destination *DestinationConfig, processor *schema.Processor, streamMode bool, keeper MonitorKeeper) (*Snowflake, error) {
	snowflakeConfig := destination.Snowflake
	if err := snowflakeConfig.Validate(); err != nil {
		return nil, err
	}
	if snowflakeConfig.Schema == "" {
		snowflakeConfig.Schema = "PUBLIC"
		logging.Errorf("name: %s type: snowflake schema wasn't provided. Will be used default one: %s", name, snowflakeConfig.Schema)
	}

	//default client_session_keep_alive
	if _, ok := snowflakeConfig.Parameters["client_session_keep_alive"]; !ok {
		t := "true"
		snowflakeConfig.Parameters["client_session_keep_alive"] = &t
	}

	if destination.Google != nil {
		if err := destination.Google.Validate(streamMode); err != nil {
			return nil, err
		}
		//stage is required when gcp integration
		if snowflakeConfig.Stage == "" {
			return nil, errors.New("Snowflake stage is required parameter in GCP integration")
		}
	}

	return NewSnowflake(ctx, name, logEventPath, destination.S3, destination.Google, snowflakeConfig, processor, destination.BreakOnError, streamMode, keeper)
}
