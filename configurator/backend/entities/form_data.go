package entities

import "encoding/json"

//MySQLFormData entity is stored in main storage (Firebase/Redis)
type MySQLFormData struct {
	Mode      string   `firestore:"mode" json:"mode"`
	TableName string   `firestore:"tableName" json:"tableName"`
	PKFields  []string `firestore:"pkFields" json:"pkFields"`

	Db       string      `firestore:"mysqlDatabase" json:"mysqlDatabase"`
	Host     string      `firestore:"mysqlHost" json:"mysqlHost"`
	Password string      `firestore:"mysqlPassword" json:"mysqlPassword"`
	Port     json.Number `firestore:"mysqlPort" json:"mysqlPort"`
	Username string      `firestore:"mysqlUser" json:"mysqlUser"`
}

//PostgresFormData entity is stored in main storage (Firebase/Redis)
type PostgresFormData struct {
	Mode      string   `firestore:"mode" json:"mode"`
	TableName string   `firestore:"tableName" json:"tableName"`
	PKFields  []string `firestore:"pkFields" json:"pkFields"`

	Db         string      `firestore:"pgdatabase" json:"pgdatabase"`
	Host       string      `firestore:"pghost" json:"pghost"`
	Password   string      `firestore:"pgpassword" json:"pgpassword"`
	Port       json.Number `firestore:"pgport" json:"pgport"`
	Schema     string      `firestore:"pgschema" json:"pgschema"`
	Username   string      `firestore:"pguser" json:"pguser"`
	DisableSSL bool        `firestore:"pgdisablessl" json:"pgdisablessl"`
}

//ClickHouseFormData entity is stored in main storage (Firebase/Redis)
type ClickHouseFormData struct {
	Mode      string `firestore:"mode" json:"mode"`
	TableName string `firestore:"tableName" json:"tableName"`

	ChCluster  string   `firestore:"ch_cluster" json:"ch_cluster"`
	ChDb       string   `firestore:"ch_database" json:"ch_database"`
	ChDsns     string   `firestore:"ch_dsns" json:"ch_dsns"`
	ChDsnsList []string `firestore:"ch_dsns_list" json:"ch_dsns_list"`
}

//RedshiftFormData entity is stored in main storage (Firebase/Redis)
type RedshiftFormData struct {
	Mode      string `firestore:"mode" json:"mode"`
	TableName string `firestore:"tableName" json:"tableName"`

	Host     string `firestore:"redshiftHost" json:"redshiftHost"`
	Db       string `firestore:"redshiftDB" json:"redshiftDB"`
	Password string `firestore:"redshiftPassword" json:"redshiftPassword"`
	Schema   string `firestore:"redshiftSchema" json:"redshiftSchema"`
	Username string `firestore:"redshiftUser" json:"redshiftUser"`

	S3AccessKey string `firestore:"redshiftS3AccessKey" json:"redshiftS3AccessKey"`
	S3Bucket    string `firestore:"redshiftS3Bucket" json:"redshiftS3Bucket"`
	S3Region    string `firestore:"redshiftS3Region" json:"redshiftS3Region"`
	S3SecretKey string `firestore:"redshiftS3SecretKey" json:"redshiftS3SecretKey"`
	UseHostedS3 bool   `firestore:"redshiftUseHostedS3" json:"redshiftUseHostedS3"`
}

// BigQueryFormData entity is stored in main storage (Firebase/Redis)
type BigQueryFormData struct {
	Mode      string `firestore:"mode" json:"mode"`
	TableName string `firestore:"tableName" json:"tableName"`

	ProjectID string `firestore:"bqProjectID" json:"bqProjectID"`
	Dataset   string `firestore:"bqDataset" json:"bqDataset"`
	JSONKey   string `firestore:"bqJSONKey" json:"bqJSONKey"`
	GCSBucket string `firestore:"bqGCSBucket" json:"bqGCSBucket"`
}

// SnowflakeFormData entity is stored in main storage (Firebase/Redis)
type SnowflakeFormData struct {
	Mode      string `firestore:"mode" json:"mode"`
	TableName string `firestore:"tableName" json:"tableName"`

	Account   string `firestore:"snowflakeAccount" json:"snowflakeAccount"`
	Warehouse string `firestore:"snowflakeWarehouse" json:"snowflakeWarehouse"`
	DB        string `firestore:"snowflakeDB" json:"snowflakeDB"`
	Schema    string `firestore:"snowflakeSchema" json:"snowflakeSchema"`
	Username  string `firestore:"snowflakeUsername" json:"snowflakeUsername"`
	Password  string `firestore:"snowflakePassword" json:"snowflakePassword"`
	StageName string `firestore:"snowflakeStageName" json:"snowflakeStageName"`

	S3Region    string `firestore:"snowflakeS3Region" json:"snowflakeS3Region"`
	S3Bucket    string `firestore:"snowflakeS3Bucket" json:"snowflakeS3Bucket"`
	S3AccessKey string `firestore:"snowflakeS3AccessKey" json:"snowflakeS3AccessKey"`
	S3SecretKey string `firestore:"snowflakeS3SecretKey" json:"snowflakeS3SecretKey"`

	GCSBucket string      `firestore:"snowflakeGcsBucket" json:"snowflakeGcsBucket"`
	GCSKey    interface{} `firestore:"snowflakeJSONKey" json:"snowflakeJSONKey"`
}

//GoogleAnalyticsFormData entity is stored in main storage (Firebase/Redis)
type GoogleAnalyticsFormData struct {
	Mode      string `firestore:"mode" json:"mode"`
	TableName string `firestore:"tableName" json:"tableName"`

	TrackingID string `firestore:"gaTrackingID" json:"gaTrackingID"`
}

//FacebookFormData entity is stored in main storage (Firebase/Redis)
type FacebookFormData struct {
	Mode      string `firestore:"mode" json:"mode"`
	TableName string `firestore:"tableName" json:"tableName"`

	PixelID     string `firestore:"fbPixelID" json:"fbPixelID"`
	AccessToken string `firestore:"fbAccessToken" json:"fbAccessToken"`
}

//WebhookFormData entity is stored in main storage (Firebase/Redis)
type WebhookFormData struct {
	Mode      string `firestore:"mode" json:"mode"`
	TableName string `firestore:"tableName" json:"tableName"`

	URL     string   `firestore:"url" json:"url"`
	Method  string   `firestore:"method" json:"method"`
	Body    string   `firestore:"body" json:"body"`
	Headers []string `firestore:"headers" json:"headers"`
}

//AmplitudeFormData entity is stored in main storage (Firebase/Redis)
type AmplitudeFormData struct {
	Mode      string `firestore:"mode" json:"mode"`
	TableName string `firestore:"tableName" json:"tableName"`

	APIKey string `firestore:"apiKey" json:"apiKey"`
}

//HubSpotFormData entity is stored in main storage (Firebase/Redis)
type HubSpotFormData struct {
	Mode      string `firestore:"mode" json:"mode"`
	TableName string `firestore:"tableName" json:"tableName"`

	APIKey string `firestore:"apiKey" json:"apiKey"`
	HubID  string `firestore:"hubID" json:"hubID"`
}
