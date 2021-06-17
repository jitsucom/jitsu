package handlers

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/middleware"
	"github.com/jitsucom/jitsu/server/storages"
	"github.com/jitsucom/jitsu/server/typing"
)

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

func testDestinationConnection(config *storages.DestinationConfig) error {
	switch config.Mode {
	case "", storages.BatchMode, storages.StreamMode:
		break
	default:
		return fmt.Errorf("Unsupported mode: '%v'", config.Mode)
	}

	switch config.Type {
	case storages.PostgresType:
		if err := config.DataSource.Validate(); err != nil {
			return err
		}

		if err := storages.TestBatchProcessing(config); err != nil {
			return err
		}

		if err := storages.TestStreamProcessing(config); err != nil {
			return err
		}

		return nil

	case storages.ClickHouseType:
		if err := config.ClickHouse.Validate(); err != nil {
			return err
		}

		factory, err := adapters.NewTableStatementFactory(config.ClickHouse)
		if err != nil {
			return err
		}

		var multiErr error
		for _, dsn := range config.ClickHouse.Dsns {
			dsnURL, err := url.Parse(strings.TrimSpace(dsn))
			if err != nil {
				multiErr = multierror.Append(multiErr, fmt.Errorf("Error parsing ClickHouse DSN %s: %v", dsn, err))
				continue
			}

			dsnQuery := dsnURL.Query()
			//add custom timeout
			dsnQuery.Set("timeout", "6s")
			dsnURL.RawQuery = dsnQuery.Encode()

			ch, err := adapters.NewClickHouse(context.Background(), dsnURL.String(),
				config.ClickHouse.Database, "", nil, factory, nil, nil, typing.SQLTypes{})
			if err != nil {
				multiErr = multierror.Append(multiErr, err)
				continue
			}

			ch.Close()
		}

		if err = storages.TestBatchProcessing(config); err != nil {
			multiErr = multierror.Append(err)
		}

		if err = storages.TestStreamProcessing(config); err != nil {
			multiErr = multierror.Append(err)
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

			defer s3.Close()

			if err = s3.ValidateWritePermission(); err != nil {
				return err
			}
		}

		redshift, err := adapters.NewAwsRedshift(context.Background(), config.DataSource, config.S3, nil, typing.SQLTypes{})
		if err != nil {
			return err
		}

		defer redshift.Close()

		if err = storages.TestBatchProcessing(config); err != nil {
			return err
		}

		if err = storages.TestStreamProcessing(config); err != nil {
			return err
		}

		return nil

	case storages.BigQueryType:
		if err := config.Google.Validate(config.Mode != storages.BatchMode); err != nil {
			return err
		}

		bq, err := adapters.NewBigQuery(context.Background(), config.Google, nil, typing.SQLTypes{})
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

			if err = googleStorage.ValidateWritePermission(); err != nil {
				return err
			}
		}

		if err := bq.Test(); err != nil {
			return err
		}

		if err = storages.TestBatchProcessing(config); err != nil {
			return err
		}

		if err = storages.TestStreamProcessing(config); err != nil {
			return err
		}

		return nil

	case storages.SnowflakeType:
		if err := config.Snowflake.Validate(); err != nil {
			return err
		}

		snowflake, err := adapters.NewSnowflake(context.Background(), config.Snowflake, nil, nil, typing.SQLTypes{})
		if err != nil {
			return err
		}

		defer snowflake.Close()

		if config.Mode == storages.BatchMode {
			if config.S3 != nil {
				if err := config.S3.Validate(); err != nil {
					return err
				}

				s3, err := adapters.NewS3(config.S3)
				if err != nil {
					return err
				}

				defer s3.Close()

				if err = s3.ValidateWritePermission(); err != nil {
					return err
				}
			} else if config.Google != nil {
				if err := config.Google.Validate(false); err != nil {
					return err
				}

				gcp, err := adapters.NewGoogleCloudStorage(context.Background(), config.Google)
				if err != nil {
					return err
				}

				defer gcp.Close()

				if err = gcp.ValidateWritePermission(); err != nil {
					return err
				}
			} else {
				return fmt.Errorf("Snowflake in batch mode needs Google or S3 configuration section")
			}
		}

		if err = storages.TestBatchProcessing(config); err != nil {
			return err
		}

		if err = storages.TestStreamProcessing(config); err != nil {
			return err
		}

		return nil

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

	default:
		return fmt.Errorf("Unsupported destination type: '%v'", config.Type)
	}
}
