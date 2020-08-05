package storages

import (
	"context"
	"errors"
	"github.com/ksensehq/tracker/adapters"
	"github.com/ksensehq/tracker/appconfig"
	"github.com/ksensehq/tracker/events"
	"github.com/ksensehq/tracker/schema"
	"github.com/spf13/viper"
	"log"
)

type DestinationConfig struct {
	OnlyTokens   []string    `mapstructure:"only_tokens"`
	Type         string      `mapstructure:"type"`
	DataLayout   *DataLayout `mapstructure:"data_layout"`
	BreakOnError bool        `mapstructure:"break_on_error"`

	DataSource *adapters.DataSourceConfig `mapstructure:"datasource"`
	S3         *adapters.S3Config         `mapstructure:"s3"`
	Google     *adapters.GoogleConfig     `mapstructure:"google"`
}

type DataLayout struct {
	Mapping           []string `mapstructure:"mapping"`
	TableNameTemplate string   `mapstructure:"table_name_template"`
}

var unknownDestination = errors.New("Unknown destination type")

func CreateStorages(ctx context.Context, destinations *viper.Viper) map[string][]events.Storage {
	stores := map[string][]events.Storage{}
	if destinations == nil {
		return stores
	}

	dc := map[string]DestinationConfig{}
	if err := destinations.Unmarshal(&dc); err != nil {
		log.Println("Error initializing destinations: wrong config format: each destination must contains one key and config as a value e.g. destinations:\n  custom_name:\n      type: redshift ...")
		return stores
	}

	for name, destination := range dc {
		if destination.Type == "" {
			destination.Type = name
		}
		log.Println("Initializing", name, "destination of type:", destination.Type)

		var storage events.Storage
		var err error
		switch destination.Type {
		case "redshift":
			storage, err = createRedshift(ctx, name, destination)
		case "bigquery":
			storage, err = createBigQuery(ctx, name, destination)
		default:
			err = unknownDestination
		}

		if err != nil {
			log.Printf("Error initializing %s destination of type %s: %v", name, destination.Type, err)
			continue
		}

		tokens := destination.OnlyTokens
		if len(tokens) == 0 {
			log.Printf("Warn: only_tokens wasn't provided. All tokens will be stored in %s %s destination", name, destination.Type)
			for token := range appconfig.Instance.AuthorizedTokens {
				tokens = append(tokens, token)
			}
		}

		for _, token := range tokens {
			stores[token] = append(stores[token], storage)
		}

	}
	return stores
}

func createRedshift(ctx context.Context, name string, destination DestinationConfig) (*AwsRedshift, error) {
	s3Config := destination.S3
	if err := s3Config.Validate(); err != nil {
		return nil, err
	}

	redshiftConfig := destination.DataSource
	if err := redshiftConfig.Validate(); err != nil {
		return nil, err
	}
	//enrich with default parameters
	if redshiftConfig.Port <= 0 {
		redshiftConfig.Port = 5439
		log.Printf("name: %s type: redshift port wasn't provided. Will be used default one: %d", name, redshiftConfig.Port)
	}
	if redshiftConfig.Schema == "" {
		redshiftConfig.Schema = "public"
		log.Printf("name: %s type: redshift schema wasn't provided. Will be used default one: %s", name, redshiftConfig.Schema)
	}

	if destination.DataLayout == nil || destination.DataLayout.TableNameTemplate == "" {
		return nil, errors.New("data_layout.table_name_template is required field")
	}

	processor, err := schema.NewProcessor(destination.DataLayout.TableNameTemplate, destination.DataLayout.Mapping)
	if err != nil {
		return nil, err
	}

	return NewAwsRedshift(ctx, s3Config, redshiftConfig, processor, destination.BreakOnError)
}

func createBigQuery(ctx context.Context, name string, destination DestinationConfig) (*BigQuery, error) {
	gConfig := destination.Google
	if err := gConfig.Validate(); err != nil {
		return nil, err
	}

	//enrich with default parameters
	if gConfig.Dataset == "" {
		gConfig.Dataset = "default"
		log.Printf("name: %s type: bigquery dataset wasn't provided. Will be used default one: %s", name, gConfig.Dataset)
	}

	if destination.DataLayout == nil || destination.DataLayout.TableNameTemplate == "" {
		return nil, errors.New("data_layout.table_name_template is required field")
	}

	processor, err := schema.NewProcessor(destination.DataLayout.TableNameTemplate, destination.DataLayout.Mapping)
	if err != nil {
		return nil, err
	}

	return NewBigQuery(ctx, gConfig, processor, destination.BreakOnError)
}
