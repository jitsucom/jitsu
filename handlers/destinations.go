package handlers

import (
	"context"
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/eventnative/adapters"
	"github.com/jitsucom/eventnative/middleware"
	"github.com/jitsucom/eventnative/storages"
	"net/http"
	"strings"
)

func DestinationsHandler(c *gin.Context) {
	destinationConfig := &storages.DestinationConfig{}
	if err := c.BindJSON(destinationConfig); err != nil {
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "Failed to parse body", Error: err.Error()})
		return
	}
	err := testConnection(destinationConfig)
	if err != nil {
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: err.Error()})
		return
	}
	c.Status(http.StatusOK)
}

func testConnection(config *storages.DestinationConfig) error {
	switch config.Type {
	case storages.PostgresType:
		if err := config.DataSource.Validate(); err != nil {
			return err
		}

		postgres, err := adapters.NewPostgres(context.Background(), config.DataSource)
		if err != nil {
			return err
		}

		postgres.Close()
		return nil
	case storages.ClickHouseType:
		if err := config.ClickHouse.Validate(); err != nil {
			return err
		}

		var multiErr error
		for _, dsn := range config.ClickHouse.Dsns {
			ch, err := adapters.NewClickHouse(context.Background(), strings.TrimSpace(dsn), "", "", nil, nil, nil)
			if err != nil {
				multiErr = multierror.Append(multiErr, err)
				continue
			} else {
				ch.Close()
			}
		}
		return multiErr
	case storages.RedshiftType:
		if err := config.DataSource.Validate(); err != nil {
			return err
		}

		if config.Mode == storages.BatchMode {
			if err := config.S3.Validate(); err != nil {
				return err
			}
			s3, err := adapters.NewS3(config.S3)
			if err != nil {
				return err
			}
			s3.Close()
		}

		redshift, err := adapters.NewAwsRedshift(context.Background(), config.DataSource, config.S3)
		if err != nil {
			return err
		}

		redshift.Close()
		return nil
	case storages.BigQueryType:
		if err := config.Google.Validate(config.Mode != storages.BatchMode); err != nil {
			return err
		}

		bq, err := adapters.NewBigQuery(context.Background(), config.Google)
		if err != nil {
			return err
		}
		defer bq.Close()
		if config.Mode == storages.BatchMode {
			googleStorage, err := adapters.NewGoogleCloudStorage(context.Background(), config.Google)
			if err != nil {
				return err
			}
			defer googleStorage.Close()
		}
		return bq.Test()
	case storages.SnowflakeType:
		if err := config.Snowflake.Validate(); err != nil {
			return err
		}
		snowflake, err := adapters.NewSnowflake(context.Background(), config.Snowflake, nil)
		if err != nil {
			return err
		}
		defer snowflake.Close()
		if config.Mode == storages.BatchMode {
			if config.S3.Bucket != "" {
				if err := config.S3.Validate(); err != nil {
					return err
				}
				s3, err := adapters.NewS3(config.S3)
				if err != nil {
					return err
				}
				defer s3.Close()
			} else if config.Google.Bucket != "" {
				if err := config.Google.Validate(false); err != nil {
					return err
				}
				gcp, err := adapters.NewGoogleCloudStorage(context.Background(), config.Google)
				if err != nil {
					return err
				}
				defer gcp.Close()
			}
		}
		return nil
	default:
		return errors.New("unsupported destination type " + config.Type)
	}
}
