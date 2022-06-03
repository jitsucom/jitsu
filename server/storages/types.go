package storages

import (
	"github.com/jitsucom/jitsu/server/drivers/base"
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
	NpmType             = "npm"
	TagType             = "tag"
	AmplitudeType       = "amplitude"
	HubSpotType         = "hubspot"
	DbtCloudType        = "dbtcloud"
)

type URSetup struct {
	PKRequired bool
}

var (
	UserRecognitionStorages = map[string]URSetup{
		MySQLType:      {true},
		PostgresType:   {true},
		RedshiftType:   {true},
		SnowflakeType:  {true},
		ClickHouseType: {false},
	}
)

//Storage is a destination representation
type Storage interface {
	io.Closer
	DryRun(payload events.Event) ([][]adapters.TableField, error)
	Store(fileName string, objects []map[string]interface{}, alreadyUploadedTables map[string]bool, needCopyEvent bool) (map[string]*StoreResult, *events.FailedEvents, *events.SkippedEvents, error)
	SyncStore(overriddenDataSchema *schema.BatchHeader, objects []map[string]interface{}, deleteConditions *base.DeleteConditions, cacheTable bool, needCopyEvent bool) error
	storeTable(fdata *schema.ProcessedFile) (*adapters.Table, error)
	ReplaceTable(originalTable, replacementTable string) error

	//Update(object map[string]interface{}) error
	Fallback(events ...*events.FailedEvent)
	GetUsersRecognition() *UserRecognitionConfiguration
	GetSyncWorker() *SyncWorker
	GetUniqueIDField() *identifiers.UniqueID
	getAdapters() (adapters.SQLAdapter, *TableHelper)
	Processor() *schema.Processor
	Init(config *Config, impl Storage, preinstalledJavaScript string, defaultUserTransform string) error
	Start(config *Config) error
	ID() string
	Type() string
	IsStaging() bool
	IsCachingDisabled() bool
	Clean(tableName string) error
}

//StorageProxy is a storage proxy
type StorageProxy interface {
	io.Closer
	Get() (Storage, bool)
	GetUniqueIDField() *identifiers.UniqueID
	GetPostHandleDestinations() []string
	GetGeoResolverID() string
	IsCachingDisabled() bool
	ID() string
	Type() string
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

	Enabled bool
}

//IsEnabled returns true if not nil and enabled
func (urc *UserRecognitionConfiguration) IsEnabled() bool {
	return urc != nil && urc.Enabled
}
