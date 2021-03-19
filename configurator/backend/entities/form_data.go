package entities

//PostgresFormData entity is stored in main storage (Firebase/Redis)
type PostgresFormData struct {
	Mode      string   `firestore:"mode" json:"mode"`
	TableName string   `firestore:"tableName" json:"tableName"`
	PKFields  []string `firestore:"pkFields" json:"pkFields"`

	Db       string `firestore:"pgdatabase" json:"pgdatabase"`
	Host     string `firestore:"pghost" json:"pghost"`
	Password string `firestore:"pgpassword" json:"pgpassword"`
	Port     int    `firestore:"pgport" json:"pgport"`
	Schema   string `firestore:"pgschema" json:"pgschema"`
	Username string `firestore:"pguser" json:"pguser"`
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

	ProjectId string `firestore:"bqProjectId" json:"bqProjectId"`
	Dataset   string `firestore:"bqDataset" json:"bqDataset"`
	JsonKey   string `firestore:"bqJSONKey" json:"bqJSONKey"`
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

	TrackingId string `firestore:"gaTrackingId" json:"gaTrackingId"`
}

//FacebookFormData entity is stored in main storage (Firebase/Redis)
type FacebookFormData struct {
	Mode      string `firestore:"mode" json:"mode"`
	TableName string `firestore:"tableName" json:"tableName"`

	PixelId     string `firestore:"fbPixelId" json:"fbPixelId"`
	AccessToken string `firestore:"fbAccessToken" json:"fbAccessToken"`
}
