package adapters

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/schema"
	"github.com/jitsucom/eventnative/typing"
	sf "github.com/snowflakedb/gosnowflake"
	"sort"
	"strings"
)

const (
	tableSchemaSFQuery      = `SELECT COLUMN_NAME, concat(DATA_TYPE, IFF(NUMERIC_SCALE is null, '', TO_VARCHAR(NUMERIC_SCALE))) from INFORMATION_SCHEMA.COLUMNS where TABLE_SCHEMA = ? and TABLE_NAME = ?`
	copyStatementFileFormat = ` FILE_FORMAT=(TYPE= 'CSV', FIELD_DELIMITER = '||' SKIP_HEADER = 1 EMPTY_FIELD_AS_NULL = true) `
	gcpFrom                 = `FROM @%s
   							   %s
                               PATTERN = '%s'`
	awsS3From = `FROM 's3://%s/%s'
					           CREDENTIALS = (aws_key_id='%s' aws_secret_key='%s') 
                               %s`

	createSFDbSchemaIfNotExistsTemplate = `CREATE SCHEMA IF NOT EXISTS %s`
	addSFColumnTemplate                 = `ALTER TABLE %s.%s ADD COLUMN %s %s`
	createSFTableTemplate               = `CREATE TABLE %s.%s (%s)`
	insertSFTemplate                    = `INSERT INTO %s.%s (%s) VALUES (%s)`
)

var (
	schemaToSnowflake = map[typing.DataType]string{
		typing.STRING:    "character varying(8192)",
		typing.INT64:     "bigint",
		typing.FLOAT64:   "numeric(38,18)",
		typing.TIMESTAMP: "timestamp(6)",
	}

	snowflakeToSchema = map[string]typing.DataType{
		"text":          typing.STRING,
		"number0":       typing.INT64,
		"number18":      typing.FLOAT64,
		"timestamp_ntz": typing.TIMESTAMP,
	}
)

//SnowflakeConfig dto for deserialized datasource config for Snowflake
type SnowflakeConfig struct {
	Account    string             `mapstructure:"account" json:"account,omitempty" yaml:"account,omitempty"`
	Port       int                `mapstructure:"port" json:"port,omitempty" yaml:"port,omitempty"`
	Db         string             `mapstructure:"db" json:"db,omitempty" yaml:"db,omitempty"`
	Schema     string             `mapstructure:"schema" json:"schema,omitempty" yaml:"schema,omitempty"`
	Username   string             `mapstructure:"username" json:"username,omitempty" yaml:"username,omitempty"`
	Password   string             `mapstructure:"password" json:"password,omitempty" yaml:"password,omitempty"`
	Warehouse  string             `mapstructure:"warehouse" json:"warehouse,omitempty" yaml:"warehouse,omitempty"`
	Stage      string             `mapstructure:"stage" json:"stage,omitempty" yaml:"stage,omitempty"`
	Parameters map[string]*string `mapstructure:"parameters" json:"parameters,omitempty" yaml:"parameters,omitempty"`
}

//Validate required fields in SnowflakeConfig
func (sc *SnowflakeConfig) Validate() error {
	if sc == nil {
		return errors.New("Snowflake config is required")
	}
	if sc.Account == "" {
		return errors.New("Snowflake account is required parameter")
	}
	if sc.Db == "" {
		return errors.New("Snowflake db is required parameter")
	}
	if sc.Username == "" {
		return errors.New("Snowflake username is required parameter")
	}
	if sc.Warehouse == "" {
		return errors.New("Snowflake warehouse is required parameter")
	}

	if sc.Parameters == nil {
		sc.Parameters = map[string]*string{}
	}

	sc.Schema = reformatValue(sc.Schema)
	return nil
}

//Snowflake is adapter for creating,patching (schema or table), inserting data to snowflake
type Snowflake struct {
	ctx           context.Context
	config        *SnowflakeConfig
	s3Config      *S3Config
	dataSource    *sql.DB
	destinationId string
	queryLogger   *logging.QueryLogger
}

//NewSnowflake return configured Snowflake adapter instance
func NewSnowflake(ctx context.Context, config *SnowflakeConfig, s3Config *S3Config,
	queryLogger *logging.QueryLogger, destinationId string) (*Snowflake, error) {
	if destinationId == "" {
		return nil, fmt.Errorf("destinationId must be not empty")
	}
	if queryLogger == nil {
		queryLogger = &logging.QueryLogger{}
	}
	cfg := &sf.Config{
		Account:   config.Account,
		User:      config.Username,
		Password:  config.Password,
		Port:      config.Port,
		Schema:    config.Schema,
		Database:  config.Db,
		Warehouse: config.Warehouse,
		Params:    config.Parameters,
	}
	connectionString, err := sf.DSN(cfg)
	if err != nil {
		return nil, err
	}

	dataSource, err := sql.Open("snowflake", connectionString)
	if err != nil {
		return nil, err
	}

	if err := dataSource.Ping(); err != nil {
		return nil, err
	}

	return &Snowflake{ctx: ctx, config: config, s3Config: s3Config, dataSource: dataSource, queryLogger: queryLogger, destinationId: destinationId}, nil
}

func (Snowflake) Name() string {
	return "Snowflake"
}

//OpenTx open underline sql transaction and return wrapped instance
func (s *Snowflake) OpenTx() (*Transaction, error) {
	tx, err := s.dataSource.BeginTx(s.ctx, nil)
	if err != nil {
		return nil, err
	}

	return &Transaction{tx: tx, dbType: s.Name()}, nil
}

//CreateDbSchema create database schema instance if doesn't exist
func (s *Snowflake) CreateDbSchema(dbSchemaName string) error {
	wrappedTx, err := s.OpenTx()
	if err != nil {
		return err
	}

	return createDbSchemaInTransaction(s.ctx, wrappedTx, createSFDbSchemaIfNotExistsTemplate,
		dbSchemaName, s.destinationId, s.queryLogger)
}

//CreateTable create database table with name,columns provided in schema.Table representation
func (s *Snowflake) CreateTable(tableSchema *schema.Table) error {
	wrappedTx, err := s.OpenTx()
	if err != nil {
		return err
	}

	var columnsDDL []string
	for columnName, column := range tableSchema.Columns {
		mappedType, ok := schemaToSnowflake[column.GetType()]
		if !ok {
			logging.Error("Unknown snowflake schema type:", column.GetType())
			mappedType = schemaToSnowflake[typing.STRING]
		}
		columnsDDL = append(columnsDDL, fmt.Sprintf(`%s %s`, reformatValue(columnName), mappedType))
	}

	//sorting columns asc
	sort.Strings(columnsDDL)
	query := fmt.Sprintf(createSFTableTemplate, s.config.Schema, reformatValue(tableSchema.Name), strings.Join(columnsDDL, ","))
	s.queryLogger.Log(s.destinationId, query)
	createStmt, err := wrappedTx.tx.PrepareContext(s.ctx, query)
	if err != nil {
		wrappedTx.Rollback()
		return fmt.Errorf("Error preparing create table %s statement: %v", tableSchema.Name, err)
	}

	_, err = createStmt.ExecContext(s.ctx)

	if err != nil {
		wrappedTx.Rollback()
		return fmt.Errorf("Error creating [%s] table: %v", tableSchema.Name, err)
	}
	return wrappedTx.tx.Commit()
}

//PatchTableSchema add new columns(from provided schema.Table) to existing table
func (s *Snowflake) PatchTableSchema(patchSchema *schema.Table) error {
	wrappedTx, err := s.OpenTx()
	if err != nil {
		return err
	}

	for columnName, column := range patchSchema.Columns {
		mappedColumnType, ok := schemaToPostgres[column.GetType()]
		if !ok {
			logging.Error("Unknown snowflake schema type:", column.GetType().String())
			mappedColumnType = schemaToSnowflake[typing.STRING]
		}
		query := fmt.Sprintf(addSFColumnTemplate, s.config.Schema,
			reformatValue(patchSchema.Name), reformatValue(columnName), mappedColumnType)
		s.queryLogger.Log(s.destinationId, query)
		alterStmt, err := wrappedTx.tx.PrepareContext(s.ctx, query)
		if err != nil {
			wrappedTx.Rollback()
			return fmt.Errorf("Error preparing patching table %s schema statement: %v", patchSchema.Name, err)
		}

		_, err = alterStmt.ExecContext(s.ctx)
		if err != nil {
			wrappedTx.Rollback()
			return fmt.Errorf("Error patching %s table with '%s' - %s column schema: %v", patchSchema.Name, columnName, mappedColumnType, err)
		}
	}

	return wrappedTx.tx.Commit()
}

//GetTableSchema return table (name,columns with name and types) representation wrapped in schema.Table struct
func (s *Snowflake) GetTableSchema(tableName string) (*schema.Table, error) {
	table := &schema.Table{Name: tableName, Columns: schema.Columns{}}

	rows, err := s.dataSource.QueryContext(s.ctx, tableSchemaSFQuery, reformatToParam(s.config.Schema), reformatToParam(reformatValue(tableName)))
	if err != nil {
		return nil, fmt.Errorf("Error querying table [%s] schema: %v", tableName, err)
	}

	defer rows.Close()
	for rows.Next() {
		var columnName, columnSnowflakeType string
		if err := rows.Scan(&columnName, &columnSnowflakeType); err != nil {
			return nil, fmt.Errorf("Error scanning result: %v", err)
		}
		mappedType, ok := snowflakeToSchema[strings.ToLower(columnSnowflakeType)]
		if !ok {
			logging.Error("Unknown snowflake column type:", columnSnowflakeType)
			mappedType = typing.STRING
		}
		table.Columns[strings.ToLower(columnName)] = schema.NewColumn(mappedType)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("Last rows.Err: %v", err)
	}

	return table, nil
}

//Copy transfer data from s3 to Snowflake by passing COPY request to Snowflake in provided wrapped transaction
func (s *Snowflake) Copy(wrappedTx *Transaction, fileKey, header, tableName string) error {
	var headerParts []string
	for _, v := range strings.Split(header, "||") {
		headerParts = append(headerParts, reformatValue(v))
	}

	statement := fmt.Sprintf(`COPY INTO %s.%s (%s) `, s.config.Schema, reformatValue(tableName), strings.Join(headerParts, ","))
	if s.s3Config != nil {
		//s3 integration stage
		statement += fmt.Sprintf(awsS3From, s.s3Config.Bucket, fileKey, s.s3Config.AccessKeyID, s.s3Config.SecretKey, copyStatementFileFormat)
	} else {
		//gcp integration stage
		statement += fmt.Sprintf(gcpFrom, s.config.Stage, copyStatementFileFormat, fileKey)
	}

	_, err := wrappedTx.tx.ExecContext(s.ctx, statement)

	return err
}

//Insert provided object in snowflake
func (s *Snowflake) Insert(schema *schema.Table, valuesMap map[string]interface{}) error {
	wrappedTx, err := s.OpenTx()
	if err != nil {
		return err
	}

	if err := s.InsertInTransaction(wrappedTx, schema, valuesMap); err != nil {
		wrappedTx.Rollback()
		return err
	}

	return wrappedTx.DirectCommit()
}

func (s *Snowflake) InsertInTransaction(wrappedTx *Transaction, schema *schema.Table, valuesMap map[string]interface{}) error {
	var header, placeholders string
	var values []interface{}
	for name, value := range valuesMap {
		header += reformatValue(name) + ","
		placeholders += "?,"
		values = append(values, value)
	}

	header = removeLastComma(header)
	placeholders = removeLastComma(placeholders)

	query := fmt.Sprintf(insertSFTemplate, s.config.Schema, reformatValue(schema.Name), header, placeholders)
	s.queryLogger.LogWithValues(s.destinationId, query, values)
	insertStmt, err := wrappedTx.tx.PrepareContext(s.ctx, query)
	if err != nil {
		return fmt.Errorf("Error preparing insert table %s statement: %v", schema.Name, err)
	}

	_, err = insertStmt.ExecContext(s.ctx, values...)
	if err != nil {
		return fmt.Errorf("Error inserting in %s table with statement: %s values: %v: %v", schema.Name, header, values, err)
	}

	return nil
}

func (s *Snowflake) UpdatePrimaryKey(patchTableSchema *schema.Table, patchConstraint *schema.PKFieldsPatch) error {
	logging.Warn("Constraints update is not supported for Snowflake yet")
	return nil
}

//Close underlying sql.DB
func (s *Snowflake) Close() (multiErr error) {
	return s.dataSource.Close()
}

//Snowflake has table with schema, table names and there
//quoted identifiers = without quotes
//unquoted identifiers = uppercased
func reformatToParam(value string) string {
	if strings.Contains(value, `"`) {
		return strings.ReplaceAll(value, `"`, ``)
	} else {
		return strings.ToUpper(value)
	}
}

//Snowflake accept names (identifiers) started with '_' or letter
//also names can contain only '_', letters, numbers, '$'
//otherwise double quote them
//https://docs.snowflake.com/en/sql-reference/identifiers-syntax.html#unquoted-identifiers
func reformatValue(value string) string {
	if len(value) > 0 {
		//must begin with a letter or underscore, or enclose in double quotes
		firstSymbol := value[0]

		if isNotLetterOrUnderscore(int32(firstSymbol)) {
			return `"` + value + `"`
		}

		for _, symbol := range value {
			if isNotLetterOrUnderscore(symbol) && isNotNumberOrDollar(symbol) {
				return `"` + value + `"`
			}
		}

	}

	return value
}

//_: 95
//A - Z: 65-90
//a - z: 97-122
func isNotLetterOrUnderscore(symbol int32) bool {
	return symbol < 65 || (symbol != 95 && symbol > 90 && symbol < 97) || symbol > 122
}

//$: 36
// 0 - 9: 48-57
func isNotNumberOrDollar(symbol int32) bool {
	return symbol != 36 && (symbol < 48 || symbol > 57)
}
