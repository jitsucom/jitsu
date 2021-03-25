package storages

import (
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/jsonutils"
	"github.com/jitsucom/jitsu/server/schema"
	"io"
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
	Store(fileName string, payload []byte, alreadyUploadedTables map[string]bool) (map[string]*StoreResult, int, error)
	StoreWithParseFunc(fileName string, payload []byte, skipTables map[string]bool, parseFunc func([]byte) (map[string]interface{}, error)) (map[string]*StoreResult, int, error)
	SyncStore(overriddenDataSchema *schema.BatchHeader, objects []map[string]interface{}, timeIntervalValue string) (int, error)
	Update(object map[string]interface{}) error
	Fallback(events ...*events.FailedEvent)
	GetUsersRecognition() *UserRecognitionConfiguration
	Name() string
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
}

type UserRecognitionConfiguration struct {
	Enabled             bool
	AnonymousIDJSONPath *jsonutils.JSONPath
	UserIDJSONPath      *jsonutils.JSONPath
}
