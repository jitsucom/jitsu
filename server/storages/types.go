package storages

import (
	"io"

	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/identifiers"
	"github.com/jitsucom/jitsu/server/jsonutils"
	"github.com/jitsucom/jitsu/server/schema"
)

const (
	RedshiftType        = "redshift"
	BigQueryType        = "bigquery"
	PostgresType        = "postgres"
	MySQLType           = "mysql"
	ClickHouseType      = "clickhouse"
	S3Type              = "s3"
	SnowflakeType       = "snowflake"
	GoogleAnalyticsType = "google_analytics"
	FacebookType        = "facebook"
	WebHookType         = "webhook"
	AmplitudeType       = "amplitude"
	HubSpotType         = "hubspot"
)

//Storage is a destination representation
type Storage interface {
	io.Closer
	DryRun(payload events.Event) ([]adapters.TableField, error)
	Store(fileName string, objects []map[string]interface{}, alreadyUploadedTables map[string]bool) (map[string]*StoreResult, *events.FailedEvents, error)
	SyncStore(overriddenDataSchema *schema.BatchHeader, objects []map[string]interface{}, timeIntervalValue string, cacheTable bool) error
	Update(object map[string]interface{}) error
	Fallback(events ...*events.FailedEvent)
	GetUsersRecognition() *UserRecognitionConfiguration
	GetUniqueIDField() *identifiers.UniqueID
	getAdapters() (adapters.SQLAdapter, *TableHelper)
	Processor() *schema.Processor
	ID() string
	Type() string
	IsStaging() bool
	IsCachingDisabled() bool
}

//StorageProxy is a storage proxy
type StorageProxy interface {
	io.Closer
	Get() (Storage, bool)
	GetUniqueIDField() *identifiers.UniqueID
	IsCachingDisabled() bool
	ID() string
}

//StoreResult is used as a Batch storing result
type StoreResult struct {
	Err       error
	RowsCount int
	EventsSrc map[string]int
}

//UserRecognitionConfiguration recognition configuration
type UserRecognitionConfiguration struct {
	AnonymousIDJSONPath      jsonutils.JSONPath
	IdentificationJSONPathes *jsonutils.JSONPaths

	enabled bool
}

//IsEnabled returns true if not nil and enabled
func (urc *UserRecognitionConfiguration) IsEnabled() bool {
	return urc != nil && urc.enabled
}
