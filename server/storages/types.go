package storages

import (
	"io"

	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/jsonutils"
	"github.com/jitsucom/jitsu/server/schema"
)

const (
	RedshiftType        = "redshift"
	BigQueryType        = "bigquery"
	PostgresType        = "postgres"
	ClickHouseType      = "clickhouse"
	S3Type              = "s3"
	SnowflakeType       = "snowflake"
	GoogleAnalyticsType = "google_analytics"
	FacebookType        = "facebook"
)

type Storage interface {
	io.Closer
	DryRun(payload events.Event) ([]adapters.TableField, error)
	Store(fileName string, objects []map[string]interface{}, alreadyUploadedTables map[string]bool) (map[string]*StoreResult, *events.FailedEvents, error)
	SyncStore(overriddenDataSchema *schema.BatchHeader, objects []map[string]interface{}, timeIntervalValue string) error
	Update(object map[string]interface{}) error
	Fallback(events ...*events.FailedEvent)
	GetUsersRecognition() *UserRecognitionConfiguration
	ID() string
	Type() string
	IsStaging() bool
}

type StorageProxy interface {
	io.Closer
	Get() (Storage, bool)
}

type StoreResult struct {
	Err       error
	RowsCount int
	EventsSrc map[string]int
}

type UserRecognitionConfiguration struct {
	Enabled                  bool
	AnonymousIDJSONPath      *jsonutils.JSONPath
	IdentificationJSONPathes *jsonutils.JSONPathes
}
