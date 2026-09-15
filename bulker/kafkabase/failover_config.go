package kafkabase

import (
	"context"
	"fmt"
	"time"

	"github.com/jitsucom/bulker/jitsubase/appbase"

	awsconfig "github.com/aws/aws-sdk-go-v2/config"
)

// FailoverLoggerEnvConfig for parsing failover logger config from environment
type FailoverLoggerEnvConfig struct {
	// Enable failover logger
	FailoverLoggerEnabled bool `mapstructure:"FAILOVER_LOGGER_ENABLED" default:"false"`

	// Log all messages (not just errors)
	FailoverLoggerLogAllMessages bool `mapstructure:"FAILOVER_LOGGER_LOG_ALL_MESSAGES" default:"false"`

	// Base path for temporary files
	FailoverLoggerBasePath string `mapstructure:"FAILOVER_LOGGER_BASE_PATH" default:"/tmp/kafka_failover"`

	// Rotation settings
	FailoverLoggerRotationPeriodMinutes int   `mapstructure:"FAILOVER_LOGGER_ROTATION_PERIOD_MINUTES" default:"60"`
	FailoverLoggerMaxSizeMB             int64 `mapstructure:"FAILOVER_LOGGER_MAX_SIZE_MB" default:"100"`
	FailoverLoggerCompressOnRotate      bool  `mapstructure:"FAILOVER_LOGGER_COMPRESS" default:"true"`

	// Codec used when compressing on rotate: "gzip" or "zstd".
	// Defaults to gzip so deploying this changes nothing at runtime - the switch is
	// an explicit config change, made only once every reader understands zstd.
	FailoverLoggerCompressionCodec string `mapstructure:"FAILOVER_LOGGER_COMPRESSION_CODEC" default:"gzip"`

	// Local destination settings
	FailoverLoggerLocalMaxOldFiles int `mapstructure:"FAILOVER_LOGGER_LOCAL_MAX_OLD_FILES" default:"10"`

	// S3 destination settings
	FailoverLoggerS3Enabled bool   `mapstructure:"FAILOVER_LOGGER_S3_ENABLED" default:"false"`
	FailoverLoggerS3Bucket  string `mapstructure:"FAILOVER_LOGGER_S3_BUCKET"`
	FailoverLoggerS3Prefix  string `mapstructure:"FAILOVER_LOGGER_S3_PREFIX" default:""`
	FailoverLoggerS3Region  string `mapstructure:"FAILOVER_LOGGER_S3_REGION" default:"us-east-1"`
}

// ToFailoverLoggerConfig converts environment config to FailoverLoggerConfig
func (c *FailoverLoggerEnvConfig) ToFailoverLoggerConfig() (*FailoverLoggerConfig, error) {
	if !c.FailoverLoggerEnabled {
		return nil, nil
	}

	config := &FailoverLoggerConfig{
		Enabled:          c.FailoverLoggerEnabled,
		LogAllMessages:   c.FailoverLoggerLogAllMessages,
		BasePath:         c.FailoverLoggerBasePath,
		RotationPeriod:   time.Duration(c.FailoverLoggerRotationPeriodMinutes) * time.Minute,
		MaxSize:          c.FailoverLoggerMaxSizeMB * 1024 * 1024, // Convert MB to bytes
		CompressOnRotate: c.FailoverLoggerCompressOnRotate,
		CompressionCodec: c.FailoverLoggerCompressionCodec,
		Destinations:     []FailoverDestination{},
	}

	// Add S3 destination first if enabled
	if c.FailoverLoggerS3Enabled {
		if c.FailoverLoggerS3Bucket == "" {
			return nil, fmt.Errorf("S3 bucket is required when S3 destination is enabled")
		}

		awsConfig, err := awsconfig.LoadDefaultConfig(context.Background(),
			awsconfig.WithRegion(c.FailoverLoggerS3Region),
		)
		if err != nil {
			return nil, fmt.Errorf("failed to load AWS config: %w", err)
		}

		s3Dest, err := NewS3Destination(c.FailoverLoggerS3Bucket, c.FailoverLoggerS3Prefix, awsConfig)
		if err != nil {
			return nil, fmt.Errorf("failed to create S3 destination: %w", err)
		}

		config.Destinations = append(config.Destinations, s3Dest)
	}

	// Always add local destination last (it moves the file)
	localDest := NewLocalFileDestination(c.FailoverLoggerBasePath, c.FailoverLoggerLocalMaxOldFiles, c.FailoverLoggerCompressOnRotate)
	config.Destinations = append(config.Destinations, localDest)

	return config, nil
}

func (c *FailoverLoggerEnvConfig) PostInit(settings *appbase.AppSettings) error {
	return nil
}
