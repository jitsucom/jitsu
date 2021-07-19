package destinations

import (
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/configurator/entities"
	enadapters "github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/schema"
	enstorages "github.com/jitsucom/jitsu/server/storages"
	"strings"
)

const defaultPrimaryKey = "eventn_ctx_event_id"

func MapConfig(destinationID string, destination *entities.Destination, defaultS3 *enadapters.S3Config) (*enstorages.DestinationConfig, error) {
	var config *enstorages.DestinationConfig
	var err error
	switch destination.Type {
	case enstorages.PostgresType:
		config, err = mapPostgres(destination)
	case enstorages.ClickHouseType:
		config, err = mapClickhouse(destination)
	case enstorages.RedshiftType:
		config, err = mapRedshift(destinationID, destination, defaultS3)
	case enstorages.BigQueryType:
		config, err = mapBigQuery(destination)
	case enstorages.SnowflakeType:
		config, err = mapSnowflake(destination)
	case enstorages.GoogleAnalyticsType:
		config, err = mapGoogleAnalytics(destination)
	case enstorages.FacebookType:
		config, err = mapFacebook(destination)
	case enstorages.WebHookType:
		config, err = mapWebhook(destination)
	case enstorages.AmplitudeType:
		config, err = mapAmplitude(destination)
	case enstorages.HubSpotType:
		config, err = mapHubSpot(destination)
	case enstorages.MySQLType:
		config, err = mapMySQL(destination)
	default:
		return nil, fmt.Errorf("Unknown destination type: %s", destination.Type)
	}
	if err != nil {
		return nil, err
	}

	enrichMappingRules(destination, config)
	setEnrichmentRules(destination, config)

	if len(destination.PrimaryKeyFields) > 0 {
		if config.DataLayout == nil {
			config.DataLayout = &enstorages.DataLayout{}
		}

		config.DataLayout.PrimaryKeyFields = destination.PrimaryKeyFields
	} else {
		//default primary keys for enabling users recognition
		//for disabling this feature set destination.DisableDefaultPrimaryKeyFields on a certain destination
		if !destination.DisableDefaultPrimaryKeyFields &&
			(destination.Type == enstorages.PostgresType || destination.Type == enstorages.MySQLType || destination.Type == enstorages.RedshiftType || destination.Type == enstorages.SnowflakeType) {
			if config.DataLayout == nil {
				config.DataLayout = &enstorages.DataLayout{}
			}

			config.DataLayout.PrimaryKeyFields = []string{defaultPrimaryKey}
		}
	}

	//overriding user recognition settings
	if destination.UsersRecognition != nil {
		config.UsersRecognition = &enstorages.UsersRecognition{
			Enabled:         destination.UsersRecognition.Enabled,
			AnonymousIDNode: destination.UsersRecognition.AnonymousIDNode,
			UserIDNode:      destination.UsersRecognition.UserIDJSONNode,
		}
	}

	//disabling destination's events caching
	if destination.CachingConfiguration != nil {
		config.CachingConfiguration = &enstorages.CachingConfiguration{Disabled: destination.CachingConfiguration.Disabled}
	}

	//only keys
	config.OnlyTokens = destination.OnlyKeys

	return config, nil
}

func mapBigQuery(bqDestination *entities.Destination) (*enstorages.DestinationConfig, error) {
	b, err := json.Marshal(bqDestination.Data)
	if err != nil {
		return nil, fmt.Errorf("error marshaling BigQuery config destination: %v", err)
	}

	bqFormData := &entities.BigQueryFormData{}
	err = json.Unmarshal(b, bqFormData)
	if err != nil {
		return nil, fmt.Errorf("error unmarshaling BigQuery form data: %v", err)
	}
	gcs := &enadapters.GoogleConfig{Project: bqFormData.ProjectID, Bucket: bqFormData.GCSBucket,
		KeyFile: bqFormData.JSONKey, Dataset: bqFormData.Dataset}
	return &enstorages.DestinationConfig{
		Type: enstorages.BigQueryType,
		Mode: bqFormData.Mode,
		DataLayout: &enstorages.DataLayout{
			TableNameTemplate: bqFormData.TableName,
		},
		Google: gcs,
	}, nil
}

func mapPostgres(pgDestinations *entities.Destination) (*enstorages.DestinationConfig, error) {
	b, err := json.Marshal(pgDestinations.Data)
	if err != nil {
		return nil, fmt.Errorf("Error marshaling postgres config destination: %v", err)
	}

	pgFormData := &entities.PostgresFormData{}
	err = json.Unmarshal(b, pgFormData)
	if err != nil {
		return nil, fmt.Errorf("Error unmarshaling postgres form data: %v", err)
	}

	var parameters map[string]string
	if pgFormData.DisableSSL {
		parameters = map[string]string{"sslmode": "disable"}
	}

	return &enstorages.DestinationConfig{
		Type: enstorages.PostgresType,
		Mode: pgFormData.Mode,
		DataLayout: &enstorages.DataLayout{
			TableNameTemplate: pgFormData.TableName,
			PrimaryKeyFields:  pgFormData.PKFields,
		},
		DataSource: &enadapters.DataSourceConfig{
			Host:       pgFormData.Host,
			Port:       pgFormData.Port,
			Db:         pgFormData.Db,
			Schema:     pgFormData.Schema,
			Username:   pgFormData.Username,
			Password:   pgFormData.Password,
			Parameters: parameters,
		},
	}, nil
}

func mapMySQL(md *entities.Destination) (*enstorages.DestinationConfig, error) {
	b, err := json.Marshal(md.Data)
	if err != nil {
		return nil, fmt.Errorf("Error marshaling MySQL config destination: %v", err)
	}

	mySQLFormData := &entities.MySQLFormData{}
	err = json.Unmarshal(b, mySQLFormData)
	if err != nil {
		return nil, fmt.Errorf("Error unmarshaling MySQL form data: %v", err)
	}

	parameters := map[string]string{"tls": "false"}

	return &enstorages.DestinationConfig{
		Type: enstorages.MySQLType,
		Mode: mySQLFormData.Mode,
		DataLayout: &enstorages.DataLayout{
			TableNameTemplate: mySQLFormData.TableName,
			PrimaryKeyFields:  mySQLFormData.PKFields,
		},
		DataSource: &enadapters.DataSourceConfig{
			Host:       mySQLFormData.Host,
			Port:       mySQLFormData.Port,
			Db:         mySQLFormData.Db,
			Schema:     mySQLFormData.Db,
			Username:   mySQLFormData.Username,
			Password:   mySQLFormData.Password,
			Parameters: parameters,
		},
	}, nil
}

func mapClickhouse(chDestinations *entities.Destination) (*enstorages.DestinationConfig, error) {
	b, err := json.Marshal(chDestinations.Data)
	if err != nil {
		return nil, fmt.Errorf("Error marshaling clickhouse config destination: %v", err)
	}

	chFormData := &entities.ClickHouseFormData{}
	err = json.Unmarshal(b, chFormData)
	if err != nil {
		return nil, fmt.Errorf("Error unmarshaling clickhouse form data: %v", err)
	}

	dsns := chFormData.ChDsnsList
	if len(dsns) == 0 {
		dsns = strings.Split(chFormData.ChDsns, ",")
	}
	return &enstorages.DestinationConfig{
		Type: enstorages.ClickHouseType,
		Mode: chFormData.Mode,
		DataLayout: &enstorages.DataLayout{
			TableNameTemplate: chFormData.TableName,
		},
		ClickHouse: &enadapters.ClickHouseConfig{
			Dsns:     dsns,
			Database: chFormData.ChDb,
			Cluster:  chFormData.ChCluster,
		},
	}, nil
}

func mapRedshift(destinationID string, rsDestinations *entities.Destination, defaultS3 *enadapters.S3Config) (*enstorages.DestinationConfig, error) {
	b, err := json.Marshal(rsDestinations.Data)
	if err != nil {
		return nil, fmt.Errorf("Error marshaling redshift config destination: %v", err)
	}

	rsFormData := &entities.RedshiftFormData{}
	err = json.Unmarshal(b, rsFormData)
	if err != nil {
		return nil, fmt.Errorf("Error unmarshaling redshift form data: %v", err)
	}

	if rsFormData.UseHostedS3 && defaultS3 == nil {
		return nil, errors.New("Jitsu default S3 bucket isn't configured")
	}

	var s3 *enadapters.S3Config
	if rsFormData.Mode == enstorages.BatchMode {
		if rsFormData.UseHostedS3 {
			s3 = &enadapters.S3Config{
				AccessKeyID: defaultS3.AccessKeyID,
				SecretKey:   defaultS3.SecretKey,
				Bucket:      defaultS3.Bucket,
				Region:      defaultS3.Region,
				Folder:      destinationID,
			}
		} else {
			s3 = &enadapters.S3Config{
				AccessKeyID: rsFormData.S3AccessKey,
				SecretKey:   rsFormData.S3SecretKey,
				Bucket:      rsFormData.S3Bucket,
				Region:      rsFormData.S3Region,
				Folder:      destinationID,
			}
		}
	}

	config := enstorages.DestinationConfig{
		Type: enstorages.RedshiftType,
		Mode: rsFormData.Mode,
		DataLayout: &enstorages.DataLayout{
			TableNameTemplate: rsFormData.TableName,
		},
		DataSource: &enadapters.DataSourceConfig{
			Host:     rsFormData.Host,
			Port:     json.Number("5439"),
			Db:       rsFormData.Db,
			Schema:   rsFormData.Schema,
			Username: rsFormData.Username,
			Password: rsFormData.Password,
		},
		S3: s3,
	}
	return &config, nil
}

func mapSnowflake(snowflakeDestination *entities.Destination) (*enstorages.DestinationConfig, error) {
	b, err := json.Marshal(snowflakeDestination.Data)
	if err != nil {
		return nil, fmt.Errorf("error marshaling Snowflake config destination: %v", err)
	}

	snowflakeFormData := &entities.SnowflakeFormData{}
	err = json.Unmarshal(b, snowflakeFormData)
	if err != nil {
		return nil, fmt.Errorf("error unmarshaling Snowflake form data: %v", err)
	}
	var s3 *enadapters.S3Config
	var gcs *enadapters.GoogleConfig
	if snowflakeFormData.S3Bucket != "" {
		s3 = &enadapters.S3Config{Region: snowflakeFormData.S3Region, Bucket: snowflakeFormData.S3Bucket, AccessKeyID: snowflakeFormData.S3AccessKey, SecretKey: snowflakeFormData.S3SecretKey}
	} else if snowflakeFormData.GCSBucket != "" {
		gcs = &enadapters.GoogleConfig{Bucket: snowflakeFormData.GCSBucket, KeyFile: snowflakeFormData.GCSKey}
	}
	return &enstorages.DestinationConfig{
		Type: enstorages.SnowflakeType,
		Mode: snowflakeFormData.Mode,
		DataLayout: &enstorages.DataLayout{
			TableNameTemplate: snowflakeFormData.TableName,
		},
		Snowflake: &enadapters.SnowflakeConfig{Account: snowflakeFormData.Account, Warehouse: snowflakeFormData.Warehouse, Db: snowflakeFormData.DB, Schema: snowflakeFormData.Schema, Username: snowflakeFormData.Username, Password: snowflakeFormData.Password, Stage: snowflakeFormData.StageName},
		S3:        s3,
		Google:    gcs,
	}, nil
}

func mapGoogleAnalytics(gaDestination *entities.Destination) (*enstorages.DestinationConfig, error) {
	b, err := json.Marshal(gaDestination.Data)
	if err != nil {
		return nil, fmt.Errorf("Error marshaling google analytics config destination: %v", err)
	}

	gaFormData := &entities.GoogleAnalyticsFormData{}
	err = json.Unmarshal(b, gaFormData)
	if err != nil {
		return nil, fmt.Errorf("Error unmarshaling google analytics form data: %v", err)
	}

	return &enstorages.DestinationConfig{
		Type: enstorages.GoogleAnalyticsType,
		Mode: gaFormData.Mode,
		GoogleAnalytics: &enadapters.GoogleAnalyticsConfig{
			TrackingID: gaFormData.TrackingID,
		},
		DataLayout: &enstorages.DataLayout{
			TableNameTemplate: gaFormData.TableName,
		},
	}, nil
}

func mapFacebook(fbDestination *entities.Destination) (*enstorages.DestinationConfig, error) {
	b, err := json.Marshal(fbDestination.Data)
	if err != nil {
		return nil, fmt.Errorf("Error marshaling facebook config destination: %v", err)
	}

	fbFormData := &entities.FacebookFormData{}
	err = json.Unmarshal(b, fbFormData)
	if err != nil {
		return nil, fmt.Errorf("Error unmarshaling facebook form data: %v", err)
	}

	return &enstorages.DestinationConfig{
		Type: enstorages.FacebookType,
		Mode: fbFormData.Mode,
		Facebook: &enadapters.FacebookConversionAPIConfig{
			PixelID:     fbFormData.PixelID,
			AccessToken: fbFormData.AccessToken,
		},
		DataLayout: &enstorages.DataLayout{
			TableNameTemplate: fbFormData.TableName,
		},
	}, nil
}

func mapWebhook(whDestination *entities.Destination) (*enstorages.DestinationConfig, error) {
	b, err := json.Marshal(whDestination.Data)
	if err != nil {
		return nil, fmt.Errorf("Error marshaling webhook config destination: %v", err)
	}

	whFormData := &entities.WebhookFormData{}
	err = json.Unmarshal(b, whFormData)
	if err != nil {
		return nil, fmt.Errorf("Error unmarshaling webhook form data: %v", err)
	}

	headers := map[string]string{}
	for _, header := range whFormData.Headers {
		nameValue := strings.Split(header, ":")
		if len(nameValue) != 2 {
			return nil, fmt.Errorf("Header malformed: %s. Must be in header_name:header_value format", header)
		}
		headers[strings.TrimSpace(nameValue[0])] = strings.TrimSpace(nameValue[1])
	}

	return &enstorages.DestinationConfig{
		Type: enstorages.WebHookType,
		Mode: whFormData.Mode,
		WebHook: &enadapters.WebHookConfig{
			URL:     whFormData.URL,
			Method:  whFormData.Method,
			Body:    whFormData.Body,
			Headers: headers,
		},
		DataLayout: &enstorages.DataLayout{
			TableNameTemplate: whFormData.TableName,
		},
	}, nil
}

func mapAmplitude(aDestination *entities.Destination) (*enstorages.DestinationConfig, error) {
	b, err := json.Marshal(aDestination.Data)
	if err != nil {
		return nil, fmt.Errorf("Error marshaling amplitude config destination: %v", err)
	}

	aFormData := &entities.AmplitudeFormData{}
	err = json.Unmarshal(b, aFormData)
	if err != nil {
		return nil, fmt.Errorf("Error unmarshaling amplitude form data: %v", err)
	}

	return &enstorages.DestinationConfig{
		Type: enstorages.AmplitudeType,
		Mode: aFormData.Mode,
		Amplitude: &enadapters.AmplitudeConfig{
			APIKey: aFormData.APIKey,
		},
		DataLayout: &enstorages.DataLayout{
			TableNameTemplate: aFormData.TableName,
		},
	}, nil
}

func mapHubSpot(hDestination *entities.Destination) (*enstorages.DestinationConfig, error) {
	b, err := json.Marshal(hDestination.Data)
	if err != nil {
		return nil, fmt.Errorf("Error marshaling hubspot config destination: %v", err)
	}

	hFormData := &entities.HubSpotFormData{}
	err = json.Unmarshal(b, hFormData)
	if err != nil {
		return nil, fmt.Errorf("Error unmarshaling hubspot form data: %v", err)
	}

	return &enstorages.DestinationConfig{
		Type: enstorages.HubSpotType,
		Mode: hFormData.Mode,
		HubSpot: &enadapters.HubSpotConfig{
			APIKey: hFormData.APIKey,
			HubID:  hFormData.HubID,
		},
		DataLayout: &enstorages.DataLayout{
			TableNameTemplate: hFormData.TableName,
		},
	}, nil
}

func enrichMappingRules(destination *entities.Destination, enDestinationConfig *enstorages.DestinationConfig) {
	if !destination.Mappings.IsEmpty() {
		var mappingFields []schema.MappingField
		for _, rule := range destination.Mappings.Rules {
			mappingFields = append(mappingFields, schema.MappingField{
				Src:        rule.SourceField,
				Dst:        rule.DestinationField,
				Action:     rule.Action,
				Type:       rule.Type,
				ColumnType: rule.ColumnType,
				Value:      rule.Value,
			})
		}

		if enDestinationConfig.DataLayout == nil {
			enDestinationConfig.DataLayout = &enstorages.DataLayout{}
		}

		enDestinationConfig.DataLayout.Mappings = &schema.Mapping{
			KeepUnmapped: &destination.Mappings.KeepFields,
			Fields:       mappingFields,
		}
	}
}

func setEnrichmentRules(destination *entities.Destination, config *enstorages.DestinationConfig) {
	if len(destination.Enrichment) > 0 {
		config.Enrichment = destination.Enrichment
	}
}
