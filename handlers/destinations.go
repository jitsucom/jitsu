package handlers

import (
	"context"
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/hashicorp/go-multierror"
	"github.com/ksensehq/eventnative/adapters"
	"github.com/ksensehq/eventnative/middleware"
	"github.com/ksensehq/eventnative/storages"
	"net/http"
	"strings"
)

func DestinationsHandler(c *gin.Context) {
	destinationConfig := &storages.DestinationConfig{}
	if err := c.BindJSON(destinationConfig); err != nil {
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "Failed to parse body", Error: err})
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
	default:
		return errors.New("unsupported destination type " + config.Type)
	}
}
