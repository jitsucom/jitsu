package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/ksensehq/eventnative/adapters"
	"log"
	"net/http"
)

type ConnectionConfig struct {
	DestinationType  string                 `json:"type"`
	ConnectionConfig map[string]interface{} `json:"config"`
}

type ConnectionTestHandler struct {
}

type RedshiftConfig struct {
	DbConfig adapters.DataSourceConfig `json:"database"`
	S3Config adapters.S3Config         `json:"s3"`
}

type SnowflakeExternalConfig struct {
	SnowflakeConfig adapters.SnowflakeConfig `json:"snowflake"`
	S3Config        adapters.S3Config        `json:"s3"`
}

func testConnection(config ConnectionConfig) error {
	switch config.DestinationType {
	case "postgres":
		var postgresConfig adapters.DataSourceConfig
		body, err := json.Marshal(config.ConnectionConfig)
		if err != nil {
			return err
		}
		err = json.Unmarshal(body, &postgresConfig)
		if err != nil {
			return err
		}
		if err := postgresConfig.Validate(); err != nil {
			return err
		}
		postgres, err := adapters.NewPostgres(context.Background(), &postgresConfig)
		if err != nil {
			return err
		}
		defer postgres.Close()
		return postgres.Test()

	case "clickhouse":
		var chConfig adapters.ClickHouseConfig
		body, err := json.Marshal(config.ConnectionConfig)
		if err != nil {
			return err
		}
		err = json.Unmarshal(body, &chConfig)
		if err != nil {
			return err
		}
		if err = chConfig.Validate(); err != nil {
			return err
		}
		tableStatementFactory, err := adapters.NewTableStatementFactory(&chConfig)
		if err != nil {
			return err
		}
		nonNullFields := map[string]bool{"eventn_ctx_event_id": true, "_timestamp": true}
		dsnsAvailable := map[string]error{}
		for i := range chConfig.Dsns {
			ch, err := adapters.NewClickHouse(context.Background(), chConfig.Dsns[i], chConfig.Database, chConfig.Cluster, chConfig.Tls, tableStatementFactory, nonNullFields)
			if err != nil {
				return err
			}
			err = ch.Test()
			if err = ch.Close(); err != nil {
				log.Printf("Failed to close clickhouse datasource %s", err)
			}
			dsnsAvailable[chConfig.Dsns[i]] = err
			if err != nil {
				return err
			}
		}
		return nil

	case "redshift":
		var rsConfig RedshiftConfig
		body, err := json.Marshal(config.ConnectionConfig)
		if err != nil {
			return err
		}
		err = json.Unmarshal(body, &rsConfig)
		if err != nil {
			return err
		}
		if err = rsConfig.DbConfig.Validate(); err != nil {
			return err
		}
		if err = rsConfig.S3Config.Validate(); err != nil {
			return err
		}
		redshift, err := adapters.NewAwsRedshift(context.Background(), &rsConfig.DbConfig, &rsConfig.S3Config)
		if err != nil {
			return err
		}
		defer redshift.Close()
		return redshift.Test()
	case "bigquery":
		return errors.New("bigquery validation is not supported")
		//googleConfig := adapters.GoogleConfig{}
		//body, err := json.Marshal(config.ConnectionConfig)
		//if err != nil {
		//	return err
		//}
		//if err = json.Unmarshal(body, &googleConfig); err != nil {
		//	return err
		//}
		//if err = googleConfig.Validate(true); err != nil {
		//	return err
		//}
		//bigQuery, err := adapters.NewBigQuery(context.Background(), &googleConfig)
		//if err != nil {
		//	return err
		//}
		//defer bigQuery.Close()
		//return bigQuery.Test()
	case "s3":
		s3Config := adapters.S3Config{}
		body, err := json.Marshal(config.ConnectionConfig)
		if err != nil {
			return err
		}
		if err = json.Unmarshal(body, &s3Config); err != nil {
			return err
		}
		if err = s3Config.Validate(); err != nil {
			return err
		}
		s3, err := adapters.NewS3(&s3Config)
		defer s3.Close()
		return err
	case "snowflake":
		snowflakeConfig := SnowflakeExternalConfig{}
		body, err := json.Marshal(config.ConnectionConfig)
		if err != nil {
			return err
		}
		if err = json.Unmarshal(body, &snowflakeConfig); err != nil {
			return err
		}
		if err = snowflakeConfig.SnowflakeConfig.Validate(); err != nil {
			return err
		}
		if err = snowflakeConfig.S3Config.Validate(); err != nil {
			return err
		}
		snowflake, err := adapters.NewSnowflake(context.Background(), &snowflakeConfig.SnowflakeConfig, &snowflakeConfig.S3Config)
		if err != nil {
			return err
		}
		defer snowflake.Close()
		return snowflake.Test()
	default:
		return errors.New("unsupported destination type " + config.DestinationType)
	}
}

type OkResponse struct {
	Status string `json:"status"`
}

type ErrorResponse struct {
	Message string `json:"message"`
	Error   error  `json:"error"`
}

func NewConnectionTestHandler() *ConnectionTestHandler {
	return &ConnectionTestHandler{}
}

func (h *ConnectionTestHandler) Handler(c *gin.Context) {
	connectionConfig := ConnectionConfig{}
	if err := c.BindJSON(&connectionConfig); err != nil {
		c.JSON(http.StatusBadRequest, ErrorResponse{Message: "Failed to parse body", Error: err})
		return
	}
	err := testConnection(connectionConfig)
	if err != nil {
		c.JSON(http.StatusBadRequest, ErrorResponse{Message: "Failed to test connection", Error: err})
		return
	}
	c.JSON(http.StatusOK, OkResponse{Status: "Connection established"})
}
