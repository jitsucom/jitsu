package storages

import (
	"context"
	"errors"
	"github.com/ksenseai/tracker/adapters"
	"github.com/ksenseai/tracker/appconfig"
	"github.com/ksenseai/tracker/events"
	"github.com/ksenseai/tracker/schema"
	"github.com/spf13/viper"
	"log"
)

type DestinationConfig struct {
	OnlyTokens   []string                   `mapstructure:"only_tokens"`
	Type         string                     `mapstructure:"type"`
	DataSource   *adapters.DataSourceConfig `mapstructure:"datasource"`
	S3           *adapters.S3Config         `mapstructure:"s3"`
	DataLayout   *DataLayout                `mapstructure:"data_layout"`
	BreakOnError bool                       `mapstructure:"break_on_error"`
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

		switch destination.Type {
		case "redshift":
			s3Config := destination.S3
			if err := s3Config.Validate(); err != nil {
				logError(name, destination.Type, err)
				continue
			}

			redshiftConfig := destination.DataSource
			if err := redshiftConfig.Validate(); err != nil {
				logError(name, destination.Type, err)
				continue
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
				logError(name, destination.Type, errors.New("data_layout.table_name_template is required field"))
				continue
			}

			processor, err := schema.NewProcessor(destination.DataLayout.TableNameTemplate, destination.DataLayout.Mapping)
			if err != nil {
				logError(name, destination.Type, err)
				continue
			}

			redshiftStorage, err := NewAwsRedshift(ctx, s3Config, redshiftConfig, processor, destination.BreakOnError)
			if err != nil {
				logError(name, destination.Type, err)
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
				stores[token] = append(stores[token], redshiftStorage)
			}

		default:
			logError(name, destination.Type, unknownDestination)
		}

	}
	return stores
}

func logError(destinationName, destinationType string, err error) {
	log.Printf("Error initializing %s destination of type %s: %v", destinationName, destinationType, err)
}
