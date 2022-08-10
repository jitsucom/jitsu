package destinations

import (
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"

	"github.com/jitsucom/jitsu/configurator/common"
	"github.com/jitsucom/jitsu/configurator/entities"
	enadapters "github.com/jitsucom/jitsu/server/adapters"
	enconfig "github.com/jitsucom/jitsu/server/config"
	enstorages "github.com/jitsucom/jitsu/server/storages"
	"github.com/jitsucom/jitsu/server/utils"
	"github.com/mitchellh/mapstructure"
)

const defaultPrimaryKey = "eventn_ctx_event_id"

func MapConfig(destinationID string, destination *entities.Destination, defaultS3 *enadapters.S3Config, postHandleDestinations []string) (*enconfig.DestinationConfig, error) {
	var config *enconfig.DestinationConfig
	var err error
	switch utils.NvlString(destination.SuperType, destination.Type) {
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
	case enstorages.GCSType:
		config, err = mapGoogleCloudStorage(destination)
	case enstorages.FacebookType:
		config, err = mapFacebook(destination)
	case enstorages.WebHookType:
		config, err = mapWebhook(destination)
	case enstorages.AmplitudeType:
		config, err = mapAmplitude(destination)
	case enstorages.HubSpotType:
		config, err = mapHubSpot(destination)
	case enstorages.DbtCloudType:
		config, err = mapDbtCloud(destination)
	case enstorages.MySQLType:
		config, err = mapMySQL(destination)
	case enstorages.S3Type:
		config, err = mapS3(destination)
	case enstorages.NpmType:
		config, err = mapNpm(destination)
	case enstorages.TagType:
		config, err = mapTag(destination)
	default:
		return nil, fmt.Errorf("Unknown destination type: %s", destination.Type)
	}
	if err != nil {
		return nil, err
	}

	enrichMappingRules(destination, config)
	if config.DataLayout == nil {
		config.DataLayout = &enconfig.DataLayout{}
	}
	if destination.TransformEnabled != nil && !*destination.TransformEnabled {
		//transform is implicitly enabled. pass only expilicit disabled values
		config.DataLayout.TransformEnabled = destination.TransformEnabled
	}
	config.DataLayout.Transform = destination.Transform
	setEnrichmentRules(destination, config)

	if len(destination.PrimaryKeyFields) > 0 {
		config.DataLayout.PrimaryKeyFields = destination.PrimaryKeyFields
	} else {
		//default primary keys for enabling users recognition
		//for disabling this feature set destination.DisableDefaultPrimaryKeyFields on a certain destination
		URSetup, ok := enstorages.UserRecognitionStorages[destination.Type]
		if !destination.DisableDefaultPrimaryKeyFields && ok && URSetup.PKRequired {
			if config.DataLayout == nil {
				config.DataLayout = &enconfig.DataLayout{}
			}

			config.DataLayout.PrimaryKeyFields = []string{defaultPrimaryKey}
		}
	}

	//overriding user recognition settings
	if destination.UsersRecognition != nil {
		config.UsersRecognition = &enconfig.UsersRecognition{
			Enabled:         destination.UsersRecognition.Enabled,
			AnonymousIDNode: destination.UsersRecognition.AnonymousIDNode,
			UserIDNode:      destination.UsersRecognition.UserIDJSONNode,
		}
	}

	//disabling destination's events caching
	if destination.CachingConfiguration != nil {
		config.CachingConfiguration = &enconfig.CachingConfiguration{Disabled: destination.CachingConfiguration.Disabled}
	}

	//only keys
	config.OnlyTokens = destination.OnlyKeys
	config.Package = destination.Package
	config.PostHandleDestinations = postHandleDestinations

	if reflect.DeepEqual(*config.DataLayout, enconfig.DataLayout{}) {
		config.DataLayout = nil
	}
	return config, nil
}

func mapS3(dest *entities.Destination) (*enconfig.DestinationConfig, error) {
	b, err := json.Marshal(dest.Data)
	if err != nil {
		return nil, fmt.Errorf("Error marshaling s3 config destination: %v", err)
	}

	s3FormData := &entities.S3FormData{}
	err = json.Unmarshal(b, s3FormData)
	if err != nil {
		return nil, fmt.Errorf("Error unmarshaling s3 form data: %v", err)
	}
	var compression enadapters.FileCompression
	if s3FormData.CompressionEnabled {
		compression = enadapters.FileCompressionGZIP
	}
	cfg := &enadapters.S3Config{
		AccessKeyID: s3FormData.AccessKeyID,
		SecretKey:   s3FormData.SecretKey,
		Bucket:      s3FormData.Bucket,
		Region:      s3FormData.Region,
		Endpoint:    s3FormData.Endpoint,
		FileConfig: enadapters.FileConfig{
			Folder:      s3FormData.Folder,
			Format:      s3FormData.Format,
			Compression: compression,
		},
	}
	cfgMap := map[string]interface{}{}
	err = mapstructure.Decode(cfg, &cfgMap)
	if err != nil {
		return nil, fmt.Errorf("Error marshalling cfg to map: %v", err)
	}
	return &enconfig.DestinationConfig{
		Type: enstorages.S3Type,
		Mode: "batch",
		DataLayout: &enconfig.DataLayout{
			TableNameTemplate: s3FormData.TableName,
		},
		Config: cfgMap,
	}, nil
}

func mapGoogleCloudStorage(dest *entities.Destination) (*enconfig.DestinationConfig, error) {
	var formData entities.GCSFormData
	if err := common.DecodeAsJSON(dest.Data, &formData); err != nil {
		return nil, err
	}

	config := &enadapters.GoogleConfig{
		Bucket:  formData.Bucket,
		KeyFile: formData.Key,
		FileConfig: enadapters.FileConfig{
			Folder: formData.Folder,
			Format: formData.Format,
		},
	}

	if formData.CompressionEnabled {
		config.Compression = enadapters.FileCompressionGZIP
	}

	var configValues map[string]interface{}
	if err := mapstructure.Decode(config, &configValues); err != nil {
		return nil, fmt.Errorf("Error marshalling config to map: %v", err)
	}

	return &enconfig.DestinationConfig{
		Type: enstorages.GCSType,
		Mode: "batch",
		DataLayout: &enconfig.DataLayout{
			TableNameTemplate: formData.TableName,
		},
		Config: configValues,
	}, nil
}

func mapBigQuery(bqDestination *entities.Destination) (*enconfig.DestinationConfig, error) {
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
	cfgMap := map[string]interface{}{}
	err = mapstructure.Decode(gcs, &cfgMap)
	if err != nil {
		return nil, fmt.Errorf("Error marshalling cfg to map: %v", err)
	}
	return &enconfig.DestinationConfig{
		Type: enstorages.BigQueryType,
		Mode: bqFormData.Mode,
		DataLayout: &enconfig.DataLayout{
			TableNameTemplate: bqFormData.TableName,
		},
		Config: cfgMap,
	}, nil
}

func mapPostgres(pgDestinations *entities.Destination) (*enconfig.DestinationConfig, error) {
	b, err := json.Marshal(pgDestinations.Data)
	if err != nil {
		return nil, fmt.Errorf("Error marshaling postgres config destination: %v", err)
	}

	pgFormData := &entities.PostgresFormData{}
	err = json.Unmarshal(b, pgFormData)
	if err != nil {
		return nil, fmt.Errorf("Error unmarshaling postgres form data: %v", err)
	}

	var sslConfig *enadapters.SSLConfig
	if pgFormData.SSLConfiguration != nil {
		sslConfig = &enadapters.SSLConfig{}
		sslConfig.ServerCA = pgFormData.SSLConfiguration.ServerCA
		sslConfig.ClientCert = pgFormData.SSLConfiguration.ClientCert
		sslConfig.ClientKey = pgFormData.SSLConfiguration.ClientKey
	}

	if pgFormData.SSLMode != enadapters.Unknown.String() {
		if sslConfig == nil {
			sslConfig = &enadapters.SSLConfig{}
		}
		sslConfig.Mode = enadapters.FromString(pgFormData.SSLMode)
	}
	var port int64
	if pgFormData.Port != "" {
		port, err = pgFormData.Port.Int64()
		if err != nil {
			return nil, fmt.Errorf("Error unmarshaling postgres port: %v", err)
		}
	}

	parameters := map[string]string{}
	for _, param := range pgFormData.Parameters {
		trimmed := strings.TrimSpace(param)
		if trimmed == "" {
			continue
		}

		parts := strings.Split(trimmed, "=")
		if len(parts) != 2 {
			return nil, fmt.Errorf("malformed parameters value: %s. Value should be in format: parameter=value", param)
		}
		parameters[parts[0]] = parts[1]
	}
	cfg := &enadapters.DataSourceConfig{
		Host:             pgFormData.Host,
		Port:             int(port),
		Db:               pgFormData.Db,
		Schema:           pgFormData.Schema,
		Username:         pgFormData.Username,
		Password:         pgFormData.Password,
		Parameters:       parameters,
		SSLConfiguration: sslConfig,
	}
	cfgMap := map[string]interface{}{}
	err = mapstructure.Decode(cfg, &cfgMap)
	if err != nil {
		return nil, fmt.Errorf("Error marshalling cfg to map: %v", err)
	}
	return &enconfig.DestinationConfig{
		Type: enstorages.PostgresType,
		Mode: pgFormData.Mode,
		DataLayout: &enconfig.DataLayout{
			TableNameTemplate: pgFormData.TableName,
			PrimaryKeyFields:  pgFormData.PKFields,
		},
		Config: cfgMap,
	}, nil
}

func mapMySQL(md *entities.Destination) (*enconfig.DestinationConfig, error) {
	b, err := json.Marshal(md.Data)
	if err != nil {
		return nil, fmt.Errorf("Error marshaling MySQL config destination: %v", err)
	}

	mySQLFormData := &entities.MySQLFormData{}
	err = json.Unmarshal(b, mySQLFormData)
	if err != nil {
		return nil, fmt.Errorf("Error unmarshaling MySQL form data: %v", err)
	}

	var parameters map[string]string
	if mySQLFormData.DisableTLS {
		parameters = map[string]string{"tls": "false"}
	}
	var port int64
	if mySQLFormData.Port != "" {
		port, err = mySQLFormData.Port.Int64()
		if err != nil {
			return nil, fmt.Errorf("Error unmarshaling postgres port: %v", err)
		}
	}
	cfg := &enadapters.DataSourceConfig{
		Host:       mySQLFormData.Host,
		Port:       int(port),
		Db:         mySQLFormData.Db,
		Schema:     mySQLFormData.Db,
		Username:   mySQLFormData.Username,
		Password:   mySQLFormData.Password,
		Parameters: parameters,
	}
	cfgMap := map[string]interface{}{}
	err = mapstructure.Decode(cfg, &cfgMap)
	if err != nil {
		return nil, fmt.Errorf("Error marshalling cfg to map: %v", err)
	}
	return &enconfig.DestinationConfig{
		Type: enstorages.MySQLType,
		Mode: mySQLFormData.Mode,
		DataLayout: &enconfig.DataLayout{
			TableNameTemplate: mySQLFormData.TableName,
			PrimaryKeyFields:  mySQLFormData.PKFields,
		},
		Config: cfgMap,
	}, nil
}

func mapClickhouse(chDestinations *entities.Destination) (*enconfig.DestinationConfig, error) {
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
	tlss := map[string]string{}
	if chFormData.ChTLS != "" {
		for i, pair := range strings.Split(chFormData.ChTLS, "&") {
			cert := strings.SplitN(pair, "=", 2)
			if len(cert) == 2 {
				tlss[cert[0]] = cert[1]
			} else if len(cert) == 1 {
				tlss[fmt.Sprintf("cert_%d", i)] = cert[0]
			}
		}
	}

	cfg := &enadapters.ClickHouseConfig{
		Dsns:     dsns,
		Database: chFormData.ChDb,
		Cluster:  chFormData.ChCluster,
		TLS:      tlss,
	}
	cfgMap := map[string]interface{}{}
	err = mapstructure.Decode(cfg, &cfgMap)
	if err != nil {
		return nil, fmt.Errorf("Error marshalling cfg to map: %v", err)
	}
	return &enconfig.DestinationConfig{
		Type: enstorages.ClickHouseType,
		Mode: chFormData.Mode,
		DataLayout: &enconfig.DataLayout{
			TableNameTemplate: chFormData.TableName,
		},
		Config: cfgMap,
	}, nil
}

func mapRedshift(destinationID string, rsDestinations *entities.Destination, defaultS3 *enadapters.S3Config) (*enconfig.DestinationConfig, error) {
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
				FileConfig: enadapters.FileConfig{
					Folder: destinationID,
				},
			}
		} else {
			s3 = &enadapters.S3Config{
				AccessKeyID: rsFormData.S3AccessKey,
				SecretKey:   rsFormData.S3SecretKey,
				Bucket:      rsFormData.S3Bucket,
				Region:      rsFormData.S3Region,
				FileConfig: enadapters.FileConfig{
					Folder: destinationID,
				},
			}
		}
	}
	cfg := &enadapters.DataSourceConfig{
		Host:     rsFormData.Host,
		Port:     5439,
		Db:       rsFormData.Db,
		Schema:   rsFormData.Schema,
		Username: rsFormData.Username,
		Password: rsFormData.Password,
		S3:       s3,
	}
	cfgMap := map[string]interface{}{}
	err = mapstructure.Decode(cfg, &cfgMap)
	if err != nil {
		return nil, fmt.Errorf("Error marshalling cfg to map: %v", err)
	}
	config := enconfig.DestinationConfig{
		Type: enstorages.RedshiftType,
		Mode: rsFormData.Mode,
		DataLayout: &enconfig.DataLayout{
			TableNameTemplate: rsFormData.TableName,
		},
		Config: cfgMap,
	}
	return &config, nil
}

func mapSnowflake(snowflakeDestination *entities.Destination) (*enconfig.DestinationConfig, error) {
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
	cfg := &enadapters.SnowflakeConfig{
		Account:   snowflakeFormData.Account,
		Warehouse: snowflakeFormData.Warehouse,
		Db:        snowflakeFormData.DB,
		Schema:    snowflakeFormData.Schema,
		Username:  snowflakeFormData.Username,
		Password:  snowflakeFormData.Password,
		Stage:     snowflakeFormData.StageName,
		S3:        s3,
		Google:    gcs,
	}
	cfgMap := map[string]interface{}{}
	err = mapstructure.Decode(cfg, &cfgMap)
	if err != nil {
		return nil, fmt.Errorf("Error marshalling cfg to map: %v", err)
	}
	return &enconfig.DestinationConfig{
		Type: enstorages.SnowflakeType,
		Mode: snowflakeFormData.Mode,
		DataLayout: &enconfig.DataLayout{
			TableNameTemplate: snowflakeFormData.TableName,
		},
		Config: cfgMap,
	}, nil
}

func mapGoogleAnalytics(gaDestination *entities.Destination) (*enconfig.DestinationConfig, error) {
	b, err := json.Marshal(gaDestination.Data)
	if err != nil {
		return nil, fmt.Errorf("Error marshaling google analytics config destination: %v", err)
	}

	gaFormData := &entities.GoogleAnalyticsFormData{}
	err = json.Unmarshal(b, gaFormData)
	if err != nil {
		return nil, fmt.Errorf("Error unmarshaling google analytics form data: %v", err)
	}

	cfg := &enadapters.GoogleAnalyticsConfig{
		TrackingID: gaFormData.TrackingID,
	}
	cfgMap := map[string]interface{}{}
	err = mapstructure.Decode(cfg, &cfgMap)
	if err != nil {
		return nil, fmt.Errorf("Error marshalling cfg to map: %v", err)
	}
	return &enconfig.DestinationConfig{
		Type:   enstorages.GoogleAnalyticsType,
		Mode:   gaFormData.Mode,
		Config: cfgMap,
		DataLayout: &enconfig.DataLayout{
			TableNameTemplate: gaFormData.TableName,
		},
	}, nil
}

func mapFacebook(fbDestination *entities.Destination) (*enconfig.DestinationConfig, error) {
	b, err := json.Marshal(fbDestination.Data)
	if err != nil {
		return nil, fmt.Errorf("Error marshaling facebook config destination: %v", err)
	}

	fbFormData := &entities.FacebookFormData{}
	err = json.Unmarshal(b, fbFormData)
	if err != nil {
		return nil, fmt.Errorf("Error unmarshaling facebook form data: %v", err)
	}

	cfg := &enadapters.FacebookConversionAPIConfig{
		PixelID:     fbFormData.PixelID,
		AccessToken: fbFormData.AccessToken,
	}
	cfgMap := map[string]interface{}{}
	err = mapstructure.Decode(cfg, &cfgMap)
	if err != nil {
		return nil, fmt.Errorf("Error marshalling cfg to map: %v", err)
	}
	return &enconfig.DestinationConfig{
		Type:   enstorages.FacebookType,
		Mode:   fbFormData.Mode,
		Config: cfgMap,
		DataLayout: &enconfig.DataLayout{
			TableNameTemplate: fbFormData.TableName,
		},
	}, nil
}

func mapWebhook(whDestination *entities.Destination) (*enconfig.DestinationConfig, error) {
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
	cfg := &enadapters.WebHookConfig{
		URL:     whFormData.URL,
		Method:  whFormData.Method,
		Body:    whFormData.Body,
		Headers: headers,
	}
	cfgMap := map[string]interface{}{}
	err = mapstructure.Decode(cfg, &cfgMap)
	if err != nil {
		return nil, fmt.Errorf("Error marshalling cfg to map: %v", err)
	}
	return &enconfig.DestinationConfig{
		Type:   enstorages.WebHookType,
		Mode:   whFormData.Mode,
		Config: cfgMap,
		DataLayout: &enconfig.DataLayout{
			TableNameTemplate: whFormData.TableName,
		},
	}, nil
}

func mapNpm(whDestination *entities.Destination) (*enconfig.DestinationConfig, error) {
	config := map[string]interface{}{}
	if whDestination.Data != nil {
		cfg, ok := whDestination.Data.(map[string]interface{})
		if ok {
			config = cfg
		}
	}
	return &enconfig.DestinationConfig{
		Type:    enstorages.NpmType,
		Mode:    "stream",
		Config:  config,
		Package: whDestination.Package,
	}, nil
}

func mapTag(tagDestination *entities.Destination) (*enconfig.DestinationConfig, error) {
	b, err := json.Marshal(tagDestination.Data)
	if err != nil {
		return nil, fmt.Errorf("Error marshaling tag config destination: %v", err)
	}

	tagFormData := &entities.TagFormData{}
	err = json.Unmarshal(b, tagFormData)
	if err != nil {
		return nil, fmt.Errorf("Error unmarshaling webhook form data: %v", err)
	}

	cfg := &enadapters.TagConfig{
		TagID:    tagFormData.TagId,
		Template: tagFormData.Template,
		Filter:   tagFormData.Filter,
	}
	cfgMap := map[string]interface{}{}
	err = mapstructure.Decode(cfg, &cfgMap)
	if err != nil {
		return nil, fmt.Errorf("Error marshalling cfg to map: %v", err)
	}
	return &enconfig.DestinationConfig{
		Type:   enstorages.TagType,
		Mode:   "synchronous",
		Config: cfgMap,
	}, nil
}

func mapAmplitude(aDestination *entities.Destination) (*enconfig.DestinationConfig, error) {
	b, err := json.Marshal(aDestination.Data)
	if err != nil {
		return nil, fmt.Errorf("Error marshaling amplitude config destination: %v", err)
	}

	aFormData := &entities.AmplitudeFormData{}
	err = json.Unmarshal(b, aFormData)
	if err != nil {
		return nil, fmt.Errorf("Error unmarshaling amplitude form data: %v", err)
	}

	cfg := &enadapters.AmplitudeConfig{
		APIKey:   aFormData.APIKey,
		Endpoint: aFormData.Endpoint,
	}
	cfgMap := map[string]interface{}{}
	err = mapstructure.Decode(cfg, &cfgMap)
	if err != nil {
		return nil, fmt.Errorf("Error marshalling cfg to map: %v", err)
	}
	return &enconfig.DestinationConfig{
		Type:   enstorages.AmplitudeType,
		Mode:   aFormData.Mode,
		Config: cfgMap,
		DataLayout: &enconfig.DataLayout{
			TableNameTemplate: aFormData.TableName,
		},
	}, nil
}

func mapHubSpot(hDestination *entities.Destination) (*enconfig.DestinationConfig, error) {
	b, err := json.Marshal(hDestination.Data)
	if err != nil {
		return nil, fmt.Errorf("Error marshaling hubspot config destination: %v", err)
	}

	hFormData := &entities.HubSpotFormData{}
	err = json.Unmarshal(b, hFormData)
	if err != nil {
		return nil, fmt.Errorf("Error unmarshaling hubspot form data: %v", err)
	}

	cfg := &enadapters.HubSpotConfig{
		APIKey: hFormData.APIKey,
		HubID:  hFormData.HubID,
	}
	cfgMap := map[string]interface{}{}
	err = mapstructure.Decode(cfg, &cfgMap)
	if err != nil {
		return nil, fmt.Errorf("Error marshalling cfg to map: %v", err)
	}
	return &enconfig.DestinationConfig{
		Type:   enstorages.HubSpotType,
		Mode:   hFormData.Mode,
		Config: cfgMap,
		DataLayout: &enconfig.DataLayout{
			TableNameTemplate: hFormData.TableName,
		},
	}, nil
}

func mapDbtCloud(hDestination *entities.Destination) (*enconfig.DestinationConfig, error) {
	b, err := json.Marshal(hDestination.Data)
	if err != nil {
		return nil, fmt.Errorf("Error marshaling dbtcloud config destination: %v", err)
	}

	dbtFormData := &entities.DbtCloudFormData{}
	err = json.Unmarshal(b, dbtFormData)
	if err != nil {
		return nil, fmt.Errorf("Error unmarshaling dbtcloud form data: %v", err)
	}
	accountId, err := dbtFormData.AccountId.Int64()
	if err != nil {
		return nil, fmt.Errorf("Error unmarshaling dbtcloud form data: %v", err)
	}
	jobId, err := dbtFormData.JobId.Int64()
	if err != nil {
		return nil, fmt.Errorf("Error unmarshaling dbtcloud form data: %v", err)
	}
	cfg := &enadapters.DbtCloudConfig{
		AccountId: int(accountId),
		JobId:     int(jobId),
		Cause:     dbtFormData.Cause,
		Token:     dbtFormData.Token,
		Enabled:   dbtFormData.Enabled,
	}
	cfgMap := map[string]interface{}{}
	err = mapstructure.Decode(cfg, &cfgMap)
	if err != nil {
		return nil, fmt.Errorf("Error marshalling cfg to map: %v", err)
	}
	return &enconfig.DestinationConfig{
		Type:   enstorages.DbtCloudType,
		Mode:   enstorages.StreamMode,
		Config: cfgMap,
		DataLayout: &enconfig.DataLayout{
			TableNameTemplate: "",
		},
	}, nil
}

func enrichMappingRules(destination *entities.Destination, enDestinationConfig *enconfig.DestinationConfig) {
	if !destination.Mappings.IsEmpty() {
		var mappingFields []enconfig.MappingField
		for _, rule := range destination.Mappings.Rules {
			mappingFields = append(mappingFields, enconfig.MappingField{
				Src:        rule.SourceField,
				Dst:        rule.DestinationField,
				Action:     rule.Action,
				Type:       rule.Type,
				ColumnType: rule.ColumnType,
				Value:      rule.Value,
			})
		}

		if enDestinationConfig.DataLayout == nil {
			enDestinationConfig.DataLayout = &enconfig.DataLayout{}
		}

		enDestinationConfig.DataLayout.Mappings = &enconfig.Mapping{
			KeepUnmapped: &destination.Mappings.KeepFields,
			Fields:       mappingFields,
		}
	}
}

func setEnrichmentRules(destination *entities.Destination, config *enconfig.DestinationConfig) {
	if len(destination.Enrichment) > 0 {
		config.Enrichment = destination.Enrichment
	}
}
