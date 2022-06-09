package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"

	"cloud.google.com/go/bigquery"
	"github.com/gin-gonic/gin"
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/config"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/identifiers"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/middleware"
	"github.com/jitsucom/jitsu/server/resources"
	"github.com/jitsucom/jitsu/server/storages"
	"github.com/jitsucom/jitsu/server/templates"
	"github.com/jitsucom/jitsu/server/timestamp"
	"github.com/jitsucom/jitsu/server/typing"
	"github.com/jitsucom/jitsu/server/uuid"
)

const (
	identifier       = "jitsu_test_connection"
	connectionErrMsg = "unable to connect to your data warehouse. Please check the access: %v"
)

type DestinationsHandler struct {
	userRecognition *config.UsersRecognition
}

func NewDestinationsHandler(userRecognition *config.UsersRecognition) *DestinationsHandler {
	return &DestinationsHandler{
		userRecognition: userRecognition,
	}
}

func (dh *DestinationsHandler) Handler(c *gin.Context) {
	destinationConfig := &config.DestinationConfig{}
	if err := c.BindJSON(destinationConfig); err != nil {
		logging.Errorf("Error parsing destinations body: %v", err)
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("Failed to parse body", err))
		return
	}
	err := testDestinationConnection(destinationConfig, dh.userRecognition)
	if err != nil {
		msg := err.Error()
		if strings.Contains(err.Error(), "i/o timeout") || storages.IsConnectionError(err) {
			msg = fmt.Sprintf(connectionErrMsg, err)
		}
		errorId := uuid.NewLettersNumbers()
		logging.Errorf("Testing Destination %s Error ID:%s Config:%s : %v", destinationConfig.Type, errorId, destinationConfig.Config, err)
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("", fmt.Errorf("Error ID:%s: %s", errorId, msg)))
		return
	}
	c.Status(http.StatusOK)
}

//testDestinationConnection creates default table with 2 fields (eventn_ctx key and timestamp)
//depends on the destination type calls destination test connection func
//returns err if has occurred
func testDestinationConnection(config *config.DestinationConfig, globalConfiguration *config.UsersRecognition) error {
	uniqueIDField := appconfig.Instance.GlobalUniqueIDField.GetFlatFieldName()
	if config.DataLayout != nil && config.DataLayout.UniqueIDField != "" {
		uniqueIDField = identifiers.NewUniqueID(config.DataLayout.UniqueIDField).GetFlatFieldName()
	}
	eventID := uuid.New()
	event := events.Event{uniqueIDField: eventID, timestamp.Key: timestamp.Now().UTC()}
	eventContext := &adapters.EventContext{
		DestinationID:  identifier,
		EventID:        eventID,
		Src:            identifier,
		RawEvent:       event,
		ProcessedEvent: event,
		Table: &adapters.Table{
			Name:     identifier + "_" + uuid.NewLettersNumbers(),
			PKFields: map[string]bool{},
		},
	}
	_, ok := storages.UserRecognitionStorages[config.Type]
	if ok {
		if config.UsersRecognition != nil {
			if config.UsersRecognition.IsEnabled() && !globalConfiguration.IsEnabled() {
				return fmt.Errorf("Error enabling user recognition for destination %s. Global user recognition configuration must be enabled first. Please add global user_recognition.enabled: true", config.Type)
			}
		} else {
			config.UsersRecognition = globalConfiguration
		}
	}
	switch config.Type {
	case storages.PostgresType:
		eventContext.Table.Columns = adapters.Columns{
			uniqueIDField: typing.SQLColumn{Type: "text"},
			timestamp.Key: typing.SQLColumn{Type: "timestamp"},
		}
		return testPostgres(config, eventContext)
	case storages.ClickHouseType:
		eventContext.Table.Columns = adapters.Columns{
			uniqueIDField: typing.SQLColumn{Type: "String"},
			timestamp.Key: typing.SQLColumn{Type: "DateTime"},
		}
		return testClickHouse(config, eventContext)
	case storages.RedshiftType:
		eventContext.Table.Columns = adapters.Columns{
			uniqueIDField: typing.SQLColumn{Type: "text"},
			timestamp.Key: typing.SQLColumn{Type: "timestamp"},
		}
		return testRedshift(config, eventContext)
	case storages.BigQueryType:
		eventContext.Table.Columns = adapters.Columns{
			uniqueIDField: typing.SQLColumn{Type: string(bigquery.StringFieldType)},
			timestamp.Key: typing.SQLColumn{Type: string(bigquery.TimestampFieldType)},
		}
		return testBigQuery(config, eventContext)
	case storages.SnowflakeType:
		eventContext.Table.Columns = adapters.Columns{
			uniqueIDField: typing.SQLColumn{Type: "text"},
			timestamp.Key: typing.SQLColumn{Type: "timestamp(6)"},
		}
		return testSnowflake(config, eventContext)
	case storages.GoogleAnalyticsType:
		cfg := &adapters.GoogleAnalyticsConfig{}
		if err := config.GetDestConfig(config.GoogleAnalytics, cfg); err != nil {
			return err
		}
		return nil
	case storages.FacebookType:
		cfg := &adapters.FacebookConversionAPIConfig{}
		if err := config.GetDestConfig(config.Facebook, cfg); err != nil {
			return err
		}
		fbAdapter := adapters.NewTestFacebookConversion(cfg)

		return fbAdapter.TestAccess()
	case storages.WebHookType:
		cfg := &adapters.WebHookConfig{}
		if err := config.GetDestConfig(config.WebHook, cfg); err != nil {
			return err
		}
		return nil
	case storages.TagType:
		cfg := &adapters.TagConfig{}
		if err := config.GetDestConfig(map[string]interface{}{}, cfg); err != nil {
			return err
		}
		_, err := adapters.NewTag(cfg, identifier)
		return err
	case storages.AmplitudeType:
		cfg := &adapters.AmplitudeConfig{}
		if err := config.GetDestConfig(config.Amplitude, cfg); err != nil {
			return err
		}
		amplitudeAdapter := adapters.NewTestAmplitude(cfg)
		return amplitudeAdapter.TestAccess()
	case storages.HubSpotType:
		cfg := &adapters.HubSpotConfig{}
		if err := config.GetDestConfig(config.HubSpot, cfg); err != nil {
			return err
		}
		hubspotAdapter := adapters.NewTestHubSpot(cfg)
		return hubspotAdapter.TestAccess()
	case storages.DbtCloudType:
		cfg := &adapters.DbtCloudConfig{}
		if err := config.GetDestConfig(config.DbtCloud, cfg); err != nil {
			return err
		}
		dbtCloudAdapter := adapters.NewTestDbtCloud(cfg)
		return dbtCloudAdapter.TestAccess()
	case storages.MySQLType:
		eventContext.Table.Columns = adapters.Columns{
			uniqueIDField: typing.SQLColumn{Type: "text"},
			timestamp.Key: typing.SQLColumn{Type: "DATETIME"},
		}
		return testMySQL(config, eventContext)
	case storages.S3Type:
		s3config := &adapters.S3Config{}
		if err := config.GetDestConfig(config.S3, s3config); err != nil {
			return err
		}
		s3Adapter, err := adapters.NewS3(s3config)
		if err != nil {
			return err
		}
		defer s3Adapter.Close()
		return s3Adapter.ValidateWritePermission()
	case storages.GCSType:
		googleConfig := &adapters.GoogleConfig{}
		if err := config.GetDestConfig(config.Google, googleConfig); err != nil {
			return err
		}
		gcsAdapter, err := adapters.NewGoogleCloudStorage(context.Background(), googleConfig)
		if err != nil {
			return err
		}
		defer gcsAdapter.Close()
		return gcsAdapter.ValidateWritePermission()
	case storages.NpmType:
		plugin := &templates.DestinationPlugin{
			Package: config.Package,
			ID:      identifier,
			Type:    storages.NpmType,
			Config:  config.Config,
		}

		executor, err := templates.NewScriptExecutor(plugin, nil)
		if err != nil {
			return err
		}

		defer executor.Close()
		return executor.Validate()
	default:
		return errors.New("unsupported destination type " + config.Type)
	}
}

//testPostgres connects to Postgres, creates table, write 1 test record, deletes table
//returns err if has occurred
func testPostgres(config *config.DestinationConfig, eventContext *adapters.EventContext) error {
	dataSourceConfig := &adapters.DataSourceConfig{}
	if err := config.GetDestConfig(config.DataSource, dataSourceConfig); err != nil {
		return err
	}

	if dataSourceConfig.Port == 0 {
		dataSourceConfig.Port = 5432
	}
	if dataSourceConfig.Schema == "" {
		dataSourceConfig.Schema = "public"
	}

	dataSourceConfig.Parameters["connect_timeout"] = "6"

	hash := resources.GetStringHash(dataSourceConfig.Host + dataSourceConfig.Username)
	dir := adapters.SSLDir(appconfig.Instance.ConfigPath, hash)
	if err := adapters.ProcessSSL(dir, dataSourceConfig); err != nil {
		return err
	}

	//delete dir with SSL
	defer func() {
		if err := os.RemoveAll(dir); err != nil {
			logging.SystemErrorf("Error deleting generated ssl config dir [%s]: %v", dir, err)
		}
	}()

	postgres, err := adapters.NewPostgres(context.Background(), dataSourceConfig, &logging.QueryLogger{}, typing.SQLTypes{})
	if err != nil {
		return err
	}

	//create db schema if doesn't exist
	err = postgres.CreateDbSchema(dataSourceConfig.Schema)
	if err != nil {
		postgres.Close()
		return err
	}

	if err = postgres.CreateTable(eventContext.Table); err != nil {
		postgres.Close()
		return err
	}

	defer func() {
		if err := postgres.DropTable(eventContext.Table); err != nil {
			logging.Errorf("Error dropping table in test connection: %v", err)
		}

		postgres.Close()
	}()

	if err = postgres.Insert(adapters.NewSingleInsertContext(eventContext)); err != nil {
		return err
	}

	return nil
}

//testClickHouse connects to all provided ClickHouse dsns, creates table, write 1 test record, deletes table
//returns err if has occurred
func testClickHouse(config *config.DestinationConfig, eventContext *adapters.EventContext) error {
	clickHouseConfig := &adapters.ClickHouseConfig{}
	if err := config.GetDestConfig(config.ClickHouse, clickHouseConfig); err != nil {
		return err
	}
	if config.UsersRecognition != nil && config.UsersRecognition.Enabled {
		engine := clickHouseConfig.Engine
		if engine != nil {
			if !strings.Contains(engine.RawStatement, "ReplacingMergeTree") {
				return fmt.Errorf("UsersRecognition for ClickHouse requires ReplacingMergeTree or ReplicatedReplacingMergeTree engine")
			}
			if len(engine.OrderFields) != 0 {
				uniqueIDField := appconfig.Instance.GlobalUniqueIDField.GetFlatFieldName()
				if config.DataLayout != nil && config.DataLayout.UniqueIDField != "" {
					uniqueIDField = identifiers.NewUniqueID(config.DataLayout.UniqueIDField).GetFlatFieldName()
				}
				if !(len(engine.OrderFields) == 1 && engine.OrderFields[0].Field == uniqueIDField) {
					return fmt.Errorf("UsersRecognition for ClickHouse requires ORDER BY Clause to contain single UniqueIDField: %s. Provided: %+v", uniqueIDField, engine.OrderFields)
				}
			}
		}

	}

	tableStatementFactory, err := adapters.NewTableStatementFactory(clickHouseConfig)
	if err != nil {
		return err
	}

	//validate dsns
	var multiErr error
	for _, dsn := range clickHouseConfig.Dsns {
		_, err := url.Parse(strings.TrimSpace(dsn))
		if err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("Error parsing ClickHouse DSN %s: %v", dsn, err))
			continue
		}
	}

	if multiErr != nil {
		return multiErr
	}

	for i, dsn := range clickHouseConfig.Dsns {
		//create N tables where N=len(dsns). For testing each dsn
		eventContext.Table.Name += strconv.Itoa(i)

		dsnURL, err := url.Parse(strings.TrimSpace(dsn))
		if err != nil {
			return err
		}

		dsnQuery := dsnURL.Query()
		//add custom timeout
		dsnQuery.Set("timeout", "6s")
		dsnURL.RawQuery = dsnQuery.Encode()

		ch, err := adapters.NewClickHouse(context.Background(), dsnURL.String(),
			clickHouseConfig.Database, clickHouseConfig.Cluster, clickHouseConfig.TLS, tableStatementFactory,
			map[string]bool{}, &logging.QueryLogger{}, typing.SQLTypes{})
		if err != nil {
			return err
		}

		if err := ch.CreateDB(clickHouseConfig.Database); err != nil {
			ch.Close()
			return err
		}

		if err = ch.CreateTable(eventContext.Table); err != nil {
			ch.Close()
			return err
		}

		insertErr := ch.Insert(adapters.NewSingleInsertContext(eventContext))

		if err := ch.DropTable(eventContext.Table); err != nil {
			logging.Errorf("Error dropping table in test connection: %v", err)
		}

		ch.Close()

		if insertErr != nil {
			return insertErr
		}
	}

	return nil
}

//testClickHouse depends on the destination mode:
// stream: connects to Redshift, creates table, writes 1 test record, deletes table
// batch: connects to Redshift, S3, creates table, writes 1 test file with 1 test record, copies it to Redshift, deletes table
//returns err if has occurred
func testRedshift(config *config.DestinationConfig, eventContext *adapters.EventContext) error {
	dataSourceConfig := &adapters.DataSourceConfig{}
	if err := config.GetDestConfig(config.DataSource, dataSourceConfig); err != nil {
		return err
	}

	if dataSourceConfig.Port == 0 {
		dataSourceConfig.Port = 5439
	}
	if dataSourceConfig.Schema == "" {
		dataSourceConfig.Schema = "public"
	}

	dataSourceConfig.Parameters["connect_timeout"] = "6"

	hash := resources.GetStringHash(dataSourceConfig.Host + dataSourceConfig.Username)
	dir := adapters.SSLDir(appconfig.Instance.ConfigPath, hash)
	if err := adapters.ProcessSSL(dir, dataSourceConfig); err != nil {
		return err
	}

	//delete dir with SSL
	defer func() {
		if err := os.RemoveAll(dir); err != nil {
			logging.SystemErrorf("Error deleting generated ssl config dir [%s]: %v", dir, err)
		}
	}()
	var s3config *adapters.S3Config
	s3c, err := config.GetConfig(dataSourceConfig.S3, config.S3, &adapters.S3Config{})
	if err != nil {
		return err
	}
	s3config, ok := s3c.(*adapters.S3Config)
	if !ok {
		s3config = &adapters.S3Config{}
	}
	redshift, err := adapters.NewAwsRedshift(context.Background(), dataSourceConfig, s3config, &logging.QueryLogger{}, typing.SQLTypes{})
	if err != nil {
		return err
	}

	//create db schema if doesn't exist
	err = redshift.CreateDbSchema(dataSourceConfig.Schema)
	if err != nil {
		redshift.Close()
		return err
	}

	if err = redshift.CreateTable(eventContext.Table); err != nil {
		redshift.Close()
		return err
	}

	defer func() {
		if err := redshift.DropTable(eventContext.Table); err != nil {
			logging.Errorf("Error dropping table in test connection: %v", err)
		}

		redshift.Close()
	}()

	if config.Mode == storages.BatchMode {
		if err := s3config.Validate(); err != nil {
			return err
		}

		s3, err := adapters.NewS3(s3config)
		if err != nil {
			return err
		}
		defer s3.Close()

		b, _ := json.Marshal(eventContext.ProcessedEvent)
		if err := s3.UploadBytes(eventContext.Table.Name, b); err != nil {
			return err
		}

		if err = redshift.Copy(eventContext.Table.Name, eventContext.Table.Name); err != nil {
			return err
		}
	} else {
		if err = redshift.Insert(adapters.NewSingleInsertContext(eventContext)); err != nil {
			return err
		}
	}

	return nil
}

//testClickHouse depends on the destination mode:
// stream: connects to BigQuery, creates table, writes 1 test record, deletes table
// batch: connects to BigQuery, Google Cloud Storage, creates table, writes 1 test file with 1 test record, copies it to BigQuery, deletes table
//returns err if has occurred
func testBigQuery(config *config.DestinationConfig, eventContext *adapters.EventContext) error {
	google := &adapters.GoogleConfig{}
	if err := config.GetDestConfig(config.Google, google); err != nil {
		return err
	}
	if config.Mode == storages.BatchMode {
		if err := google.ValidateBatchMode(); err != nil {
			return err
		}
	}

	if google.Project == "" {
		return errors.New("BigQuery project 'bq_project' is required parameter")
	}

	if google.Dataset == "" {
		google.Dataset = "default"
	}

	bq, err := adapters.NewBigQuery(context.Background(), google, &logging.QueryLogger{}, typing.SQLTypes{})
	if err != nil {
		return err
	}

	//create dataset if doesn't exist
	err = bq.CreateDataset(google.Dataset)
	if err != nil {
		bq.Close()
		return err
	}

	if err = bq.CreateTable(eventContext.Table); err != nil {
		bq.Close()
		return err
	}

	defer func() {
		if err := bq.DropTable(eventContext.Table); err != nil {
			logging.Errorf("Error dropping table in test connection: %v", err)
		}

		bq.Close()
	}()

	if config.Mode == storages.BatchMode {
		googleStorage, err := adapters.NewGoogleCloudStorage(context.Background(), google)
		if err != nil {
			return err
		}
		defer googleStorage.Close()

		b, _ := json.Marshal(eventContext.ProcessedEvent)
		if err := googleStorage.UploadBytes(eventContext.Table.Name, b); err != nil {
			return err
		}

		if err = bq.Copy(eventContext.Table.Name, eventContext.Table.Name); err != nil {
			return err
		}
	} else {
		if err = bq.Insert(adapters.NewSingleInsertContext(eventContext)); err != nil {
			return err
		}
	}

	return nil
}

//testClickHouse depends on the destination mode:
// stream: connects to Snowflake, creates table, writes 1 test record, deletes table
// batch: connects to Snowflake, S3 or Google Cloud Storage, creates table, writes 1 test file with 1 test record, copies it to Snowflake, deletes table
//returns err if has occurred
func testSnowflake(config *config.DestinationConfig, eventContext *adapters.EventContext) error {
	snowflakeConfig := &adapters.SnowflakeConfig{}
	if err := config.GetDestConfig(config.Snowflake, snowflakeConfig); err != nil {
		return err
	}

	if snowflakeConfig.Schema == "" {
		snowflakeConfig.Schema = "PUBLIC"
	}

	timeout := "6"
	snowflakeConfig.Parameters["statement_timeout_in_seconds"] = &timeout

	var s3config *adapters.S3Config
	s3c, err := config.GetConfig(snowflakeConfig.S3, config.S3, &adapters.S3Config{})
	if err != nil {
		return err
	}
	s3config, _ = s3c.(*adapters.S3Config)
	var googleConfig *adapters.GoogleConfig
	gc, err := config.GetConfig(snowflakeConfig.Google, config.Google, &adapters.GoogleConfig{})
	if err != nil {
		return err
	}
	googleConfig, googleOk := gc.(*adapters.GoogleConfig)

	snowflake, err := storages.CreateSnowflakeAdapter(context.Background(), s3config, *snowflakeConfig, &logging.QueryLogger{}, typing.SQLTypes{})
	if err != nil {
		return err
	}

	if err = snowflake.CreateTable(eventContext.Table); err != nil {
		snowflake.Close()
		return err
	}

	defer func() {
		if err := snowflake.DropTable(eventContext.Table); err != nil {
			logging.Errorf("Error dropping table in test connection: %v", err)
		}

		snowflake.Close()
	}()

	var header []string
	for column := range eventContext.Table.Columns {
		header = append(header, column)
	}

	if config.Mode == storages.BatchMode {
		var stageAdapter adapters.Stage
		if googleOk {
			//with google stage
			if err := googleConfig.Validate(); err != nil {
				return err
			}
			//stage is required when gcp integration
			if snowflakeConfig.Stage == "" {
				return errors.New("Snowflake stage is required parameter in GCP integration")
			}
			stageAdapter, err = adapters.NewGoogleCloudStorage(context.Background(), googleConfig)
			if err != nil {
				return err
			}
		} else {
			if err := s3config.Validate(); err != nil {
				return err
			}

			stageAdapter, err = adapters.NewS3(s3config)
			if err != nil {
				return err
			}
		}

		defer stageAdapter.Close()

		b, _ := json.Marshal(eventContext.ProcessedEvent)
		if err := stageAdapter.UploadBytes(eventContext.Table.Name, b); err != nil {
			return err
		}

		if err = snowflake.Copy(eventContext.Table.Name, eventContext.Table.Name, header); err != nil {
			return err
		}
	} else {
		if err = snowflake.Insert(adapters.NewSingleInsertContext(eventContext)); err != nil {
			return err
		}
	}

	return nil
}

//testMySQL connects to MySQL, creates table, write 1 test record, deletes table
//returns err if has occurred
func testMySQL(config *config.DestinationConfig, eventContext *adapters.EventContext) error {
	dataSourceConfig := &adapters.DataSourceConfig{}
	if err := config.GetDestConfig(config.DataSource, dataSourceConfig); err != nil {
		return err
	}

	if dataSourceConfig.Port == 0 {
		dataSourceConfig.Port = 3306
	}

	dataSourceConfig.Parameters["timeout"] = "6s"

	mysql, err := storages.CreateMySQLAdapter(context.Background(), *dataSourceConfig, &logging.QueryLogger{}, typing.SQLTypes{})
	if err != nil {
		return err
	}

	if err = mysql.CreateTable(eventContext.Table); err != nil {
		mysql.Close()
		return err
	}

	defer func() {
		if err := mysql.DropTable(eventContext.Table); err != nil {
			logging.Errorf("Error dropping table in test connection: %v", err)
		}

		mysql.Close()
	}()

	if err = mysql.Insert(adapters.NewSingleInsertContext(eventContext)); err != nil {
		return err
	}

	return nil
}
