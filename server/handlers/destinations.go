package handlers

import (
	"cloud.google.com/go/bigquery"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/timestamp"
	"github.com/jitsucom/jitsu/server/typing"
	"github.com/jitsucom/jitsu/server/uuid"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/middleware"
	"github.com/jitsucom/jitsu/server/storages"
)

const identifier = "jitsu_test_connection"

func DestinationsHandler(c *gin.Context) {
	destinationConfig := &storages.DestinationConfig{}
	if err := c.BindJSON(destinationConfig); err != nil {
		logging.Errorf("Error parsing destinations body: %v", err)
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("Failed to parse body", err))
		return
	}
	err := testDestinationConnection(destinationConfig)
	if err != nil {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse(err.Error(), nil))
		return
	}
	c.Status(http.StatusOK)
}

//testDestinationConnection creates default table with 2 fields (eventn_ctx key and timestamp)
//depends on the destination type calls destination test connection func
//returns err if has occurred
func testDestinationConnection(config *storages.DestinationConfig) error {
	uniqueIDField := appconfig.Instance.GlobalUniqueIDField.GetFlatFieldName()
	eventID := uuid.New()
	event := events.Event{uniqueIDField: eventID, timestamp.Key: time.Now().UTC()}
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
	switch config.Type {
	case storages.PostgresType:
		eventContext.Table.Columns = adapters.Columns{
			uniqueIDField: adapters.Column{SQLType: "text"},
			timestamp.Key: adapters.Column{SQLType: "timestamp"},
		}
		return testPostgres(config, eventContext)
	case storages.ClickHouseType:
		eventContext.Table.Columns = adapters.Columns{
			uniqueIDField: adapters.Column{SQLType: "String"},
			timestamp.Key: adapters.Column{SQLType: "DateTime"},
		}
		return testClickHouse(config, eventContext)
	case storages.RedshiftType:
		eventContext.Table.Columns = adapters.Columns{
			uniqueIDField: adapters.Column{SQLType: "text"},
			timestamp.Key: adapters.Column{SQLType: "timestamp"},
		}
		return testRedshift(config, eventContext)
	case storages.BigQueryType:
		eventContext.Table.Columns = adapters.Columns{
			uniqueIDField: adapters.Column{SQLType: string(bigquery.StringFieldType)},
			timestamp.Key: adapters.Column{SQLType: string(bigquery.TimestampFieldType)},
		}
		return testBigQuery(config, eventContext)
	case storages.SnowflakeType:
		eventContext.Table.Columns = adapters.Columns{
			uniqueIDField: adapters.Column{SQLType: "text"},
			timestamp.Key: adapters.Column{SQLType: "timestamp(6)"},
		}
		return testSnowflake(config, eventContext)
	case storages.GoogleAnalyticsType:
		if err := config.GoogleAnalytics.Validate(); err != nil {
			return err
		}

		return nil
	case storages.FacebookType:
		if err := config.Facebook.Validate(); err != nil {
			return err
		}

		fbAdapter := adapters.NewTestFacebookConversion(config.Facebook)

		return fbAdapter.TestAccess()
	case storages.WebHookType:
		if err := config.WebHook.Validate(); err != nil {
			return err
		}

		return nil
	case storages.AmplitudeType:
		if err := config.Amplitude.Validate(); err != nil {
			return err
		}

		amplitudeAdapter := adapters.NewTestAmplitude(config.Amplitude)
		return amplitudeAdapter.TestAccess()
	case storages.HubSpotType:
		if err := config.HubSpot.Validate(); err != nil {
			return err
		}

		hubspotAdapter := adapters.NewTestHubSpot(config.HubSpot)
		return hubspotAdapter.TestAccess()
	case storages.MySQLType:
		if err := config.DataSource.Validate(); err != nil {
			return err
		}

		mySQL, err := adapters.NewMySQL(context.Background(), config.DataSource, nil, typing.SQLTypes{})
		if err != nil {
			return err
		}

		mySQL.Close()
		return nil
	default:
		return errors.New("unsupported destination type " + config.Type)
	}
}

//testPostgres connects to Postgres, creates table, write 1 test record, deletes table
//returns err if has occurred
func testPostgres(config *storages.DestinationConfig, eventContext *adapters.EventContext) error {
	if err := config.DataSource.Validate(); err != nil {
		return err
	}

	if config.DataSource.Port.String() == "" {
		config.DataSource.Port = "5432"
	}
	if config.DataSource.Schema == "" {
		config.DataSource.Schema = "public"
	}

	postgres, err := adapters.NewPostgres(context.Background(), config.DataSource, &logging.QueryLogger{}, typing.SQLTypes{})
	if err != nil {
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

	if err = postgres.Insert(eventContext); err != nil {
		return err
	}

	return nil
}

//testClickHouse connects to all provided ClickHouse dsns, creates table, write 1 test record, deletes table
//returns err if has occurred
func testClickHouse(config *storages.DestinationConfig, eventContext *adapters.EventContext) error {
	if err := config.ClickHouse.Validate(); err != nil {
		return err
	}

	tableStatementFactory, err := adapters.NewTableStatementFactory(config.ClickHouse)
	if err != nil {
		return err
	}

	//validate dsns
	var multiErr error
	for _, dsn := range config.ClickHouse.Dsns {
		_, err := url.Parse(strings.TrimSpace(dsn))
		if err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("Error parsing ClickHouse DSN %s: %v", dsn, err))
			continue
		}
	}

	if multiErr != nil {
		return multiErr
	}

	for _, dsn := range config.ClickHouse.Dsns {
		dsnURL, err := url.Parse(strings.TrimSpace(dsn))
		if err != nil {
			return err
		}

		dsnQuery := dsnURL.Query()
		//add custom timeout
		dsnQuery.Set("timeout", "6s")
		dsnURL.RawQuery = dsnQuery.Encode()

		ch, err := adapters.NewClickHouse(context.Background(), dsnURL.String(),
			config.ClickHouse.Database, config.ClickHouse.Cluster, config.ClickHouse.TLS, tableStatementFactory,
			map[string]bool{}, &logging.QueryLogger{}, typing.SQLTypes{})
		if err != nil {
			return err
		}

		if err = ch.CreateTable(eventContext.Table); err != nil {
			ch.Close()
			return err
		}

		insertErr := ch.Insert(eventContext)

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
func testRedshift(config *storages.DestinationConfig, eventContext *adapters.EventContext) error {
	if err := config.DataSource.Validate(); err != nil {
		return err
	}

	if config.DataSource.Port.String() == "" {
		config.DataSource.Port = "5439"
	}
	if config.DataSource.Schema == "" {
		config.DataSource.Schema = "public"
	}

	redshift, err := adapters.NewAwsRedshift(context.Background(), config.DataSource, config.S3, &logging.QueryLogger{}, typing.SQLTypes{})
	if err != nil {
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
		if err := config.S3.Validate(); err != nil {
			return err
		}

		s3, err := adapters.NewS3(config.S3)
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
		if err = redshift.Insert(eventContext); err != nil {
			return err
		}
	}

	return nil
}

//testClickHouse depends on the destination mode:
// stream: connects to BigQuery, creates table, writes 1 test record, deletes table
// batch: connects to BigQuery, Google Cloud Storage, creates table, writes 1 test file with 1 test record, copies it to BigQuery, deletes table
//returns err if has occurred
func testBigQuery(config *storages.DestinationConfig, eventContext *adapters.EventContext) error {
	if err := config.Google.Validate(config.Mode != storages.BatchMode); err != nil {
		return err
	}

	if config.Google.Project == "" {
		return errors.New("BigQuery project 'bq_project' is required parameter")
	}

	if config.Google.Dataset == "" {
		config.Google.Dataset = "default"
	}
	bq, err := adapters.NewBigQuery(context.Background(), config.Google, &logging.QueryLogger{}, typing.SQLTypes{})
	if err != nil {
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
		googleStorage, err := adapters.NewGoogleCloudStorage(context.Background(), config.Google)
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
		if err = bq.Insert(eventContext); err != nil {
			return err
		}
	}

	return nil
}

//testClickHouse depends on the destination mode:
// stream: connects to Snowflake, creates table, writes 1 test record, deletes table
// batch: connects to Snowflake, S3 or Google Cloud Storage, creates table, writes 1 test file with 1 test record, copies it to Snowflake, deletes table
//returns err if has occurred
func testSnowflake(config *storages.DestinationConfig, eventContext *adapters.EventContext) error {
	if err := config.Snowflake.Validate(); err != nil {
		return err
	}

	if config.Snowflake.Schema == "" {
		config.Snowflake.Schema = "PUBLIC"
	}

	snowflake, err := storages.CreateSnowflakeAdapter(context.Background(), config.S3, *config.Snowflake, &logging.QueryLogger{}, typing.SQLTypes{})
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
		if config.Google != nil {
			//with google stage
			if err := config.Google.Validate(config.Mode == storages.StreamMode); err != nil {
				return err
			}
			//stage is required when gcp integration
			if config.Snowflake.Stage == "" {
				return errors.New("Snowflake stage is required parameter in GCP integration")
			}
			stageAdapter, err = adapters.NewGoogleCloudStorage(context.Background(), config.Google)
			if err != nil {
				return err
			}
		} else {
			if err := config.S3.Validate(); err != nil {
				return err
			}

			stageAdapter, err = adapters.NewS3(config.S3)
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
		if err = snowflake.Insert(eventContext); err != nil {
			return err
		}
	}

	return nil
}
