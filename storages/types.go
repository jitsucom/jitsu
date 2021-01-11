package storages

import (
	"github.com/jitsucom/eventnative/events"
	"github.com/jitsucom/eventnative/jsonutils"
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
)

type DryRunResponse struct {
	Name  string      `json:"name"`
	Type  string      `json:"type"`
	Value interface{} `json:"value"`
}

type Storage interface {
	io.Closer
	DryRun(payload events.Event) ([]DryRunResponse, error)
	Store(fileName string, payload []byte, alreadyUploadedTables map[string]bool) (map[string]*StoreResult, int, error)
	StoreWithParseFunc(fileName string, payload []byte, skipTables map[string]bool, parseFunc func([]byte) (map[string]interface{}, error)) (map[string]*StoreResult, int, error)
	SyncStore(tableName string, objects []map[string]interface{}, timeIntervalValue string) (int, error)
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
	AnonymousIdJsonPath *jsonutils.JsonPath
	UserIdJsonPath      *jsonutils.JsonPath
}
