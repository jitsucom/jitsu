package adapters

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/typing"
	sf "github.com/snowflakedb/gosnowflake"
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
	addSFColumnTemplate                 = `ALTER TABLE %s.%s ADD COLUMN %s`
	createSFTableTemplate               = `CREATE TABLE %s.%s (%s)`
	deleteSFTableTemplate               = `DROP TABLE %s.%s`
	insertSFTemplate                    = `INSERT INTO %s.%s (%s) VALUES (%s)`
)

var (
	SchemaToSnowflake = map[typing.DataType]string{
		typing.STRING:    "text",
		typing.INT64:     "bigint",
		typing.FLOAT64:   "numeric(38,18)",
		typing.TIMESTAMP: "timestamp(6)",
		typing.BOOL:      "boolean",
		typing.UNKNOWN:   "text",
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
	ctx         context.Context
	config      *SnowflakeConfig
	s3Config    *S3Config
	dataSource  *sql.DB
	queryLogger *logging.QueryLogger
	sqlTypes    typing.SQLTypes
}

//NewSnowflake returns configured Snowflake adapter instance
func NewSnowflake(ctx context.Context, config *SnowflakeConfig, s3Config *S3Config,
	queryLogger *logging.QueryLogger, sqlTypes typing.SQLTypes) (*Snowflake, error) {
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
		dataSource.Close()
		return nil, err
	}

	return &Snowflake{ctx: ctx, config: config, s3Config: s3Config, dataSource: dataSource, queryLogger: queryLogger, sqlTypes: reformatMappings(sqlTypes, SchemaToSnowflake)}, nil
}

func (Snowflake) Type() string {
	return "Snowflake"
}

//OpenTx open underline sql transaction and return wrapped instance
func (s *Snowflake) OpenTx() (*Transaction, error) {
	tx, err := s.dataSource.BeginTx(s.ctx, nil)
	if err != nil {
		return nil, err
	}

	return &Transaction{tx: tx, dbType: s.Type()}, nil
}

//CreateDbSchema create database schema instance if doesn't exist
func (s *Snowflake) CreateDbSchema(dbSchemaName string) error {
	wrappedTx, err := s.OpenTx()
	if err != nil {
		return err
	}

	return createDbSchemaInTransaction(s.ctx, wrappedTx, createSFDbSchemaIfNotExistsTemplate,
		dbSchemaName, s.queryLogger)
}

//CreateTable creates database table with name,columns provided in Table representation
func (s *Snowflake) CreateTable(tableSchema *Table) error {
	wrappedTx, err := s.OpenTx()
	if err != nil {
		return err
	}

	var columnsDDL []string
	for columnName, column := range tableSchema.Columns {
		columnDDL := s.columnDDL(columnName, column)
		columnsDDL = append(columnsDDL, columnDDL)
	}

	//sorting columns asc
	sort.Strings(columnsDDL)
	query := fmt.Sprintf(createSFTableTemplate, s.config.Schema, reformatValue(tableSchema.Name), strings.Join(columnsDDL, ","))
	s.queryLogger.LogDDL(query)
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

// DeleteTable removes database table with name provided in Table representation
func (s *Snowflake) DeleteTable(table *Table) error {
	wrappedTx, err := s.OpenTx()
	if err != nil {
		return err
	}

	query := fmt.Sprintf(deleteSFTableTemplate, s.config.Schema, reformatValue(table.Name))
	s.queryLogger.LogDDL(query)

	if _, err = wrappedTx.tx.ExecContext(s.ctx, query); err != nil {
		wrappedTx.Rollback()
		return fmt.Errorf("Error deleting [%s] table: %v", table.Name, err)
	}

	return wrappedTx.tx.Commit()
}

//PatchTableSchema add new columns(from provided Table) to existing table
func (s *Snowflake) PatchTableSchema(patchSchema *Table) error {
	wrappedTx, err := s.OpenTx()
	if err != nil {
		return err
	}

	for columnName, column := range patchSchema.Columns {
		columnDDL := s.columnDDL(columnName, column)

		query := fmt.Sprintf(addSFColumnTemplate, s.config.Schema,
			reformatValue(patchSchema.Name), columnDDL)
		s.queryLogger.LogDDL(query)
		alterStmt, err := wrappedTx.tx.PrepareContext(s.ctx, query)
		if err != nil {
			wrappedTx.Rollback()
			return fmt.Errorf("Error preparing patching table %s schema statement: %v", patchSchema.Name, err)
		}

		_, err = alterStmt.ExecContext(s.ctx)
		if err != nil {
			wrappedTx.Rollback()
			return fmt.Errorf("Error patching %s table with '%s' - %s column schema: %v", patchSchema.Name, columnName, column.SQLType, err)
		}
	}

	return wrappedTx.tx.Commit()
}

//GetTableSchema return table (name,columns with name and types) representation wrapped in Table struct
func (s *Snowflake) GetTableSchema(tableName string) (*Table, error) {
	table := &Table{Name: tableName, Columns: Columns{}}

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

		table.Columns[strings.ToLower(columnName)] = Column{SQLType: columnSnowflakeType}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("Last rows.Err: %v", err)
	}

	return table, nil
}

//Copy transfer data from s3 to Snowflake by passing COPY request to Snowflake
func (s *Snowflake) Copy(fileName, tableName string, header []string) error {
	var reformattedHeader []string
	for _, v := range header {
		reformattedHeader = append(reformattedHeader, reformatValue(v))
	}

	wrappedTx, err := s.OpenTx()
	if err != nil {
		return err
	}

	statement := fmt.Sprintf(`COPY INTO %s.%s (%s) `, s.config.Schema, reformatValue(tableName), strings.Join(reformattedHeader, ","))
	if s.s3Config != nil {
		//s3 integration stage
		if s.s3Config.Folder != "" {
			fileName = s.s3Config.Folder + "/" + fileName
		}
		statement += fmt.Sprintf(awsS3From, s.s3Config.Bucket, fileName, s.s3Config.AccessKeyID, s.s3Config.SecretKey, copyStatementFileFormat)
	} else {
		//gcp integration stage
		statement += fmt.Sprintf(gcpFrom, s.config.Stage, copyStatementFileFormat, fileName)
	}

	_, err = wrappedTx.tx.ExecContext(s.ctx, statement)
	if err != nil {
		wrappedTx.Rollback()
		return err
	}

	return wrappedTx.DirectCommit()
}

//Insert provided object in snowflake
func (s *Snowflake) Insert(eventContext *EventContext) error {
	var header, placeholders string
	var values []interface{}
	for name, value := range eventContext.ProcessedEvent {
		header += reformatValue(name) + ","

		castClause := s.getCastClause(name)
		placeholders += "?" + castClause + ","
		values = append(values, value)
	}

	header = removeLastComma(header)
	placeholders = removeLastComma(placeholders)

	query := fmt.Sprintf(insertSFTemplate, s.config.Schema, reformatValue(eventContext.Table.Name), header, placeholders)
	s.queryLogger.LogQueryWithValues(query, values)

	wrappedTx, err := s.OpenTx()
	if err != nil {
		return err
	}

	insertStmt, err := wrappedTx.tx.PrepareContext(s.ctx, query)
	if err != nil {
		wrappedTx.Rollback()
		return fmt.Errorf("Error preparing insert table %s statement: %v", eventContext.Table.Name, err)
	}

	_, err = insertStmt.ExecContext(s.ctx, values...)
	if err != nil {
		wrappedTx.Rollback()
		return fmt.Errorf("Error inserting in %s table with statement: %s values: %v: %v", eventContext.Table.Name, header, values, err)
	}

	return wrappedTx.DirectCommit()
}

//Close underlying sql.DB
func (s *Snowflake) Close() (multiErr error) {
	return s.dataSource.Close()
}

//getCastClause returns ::SQL_TYPE clause or empty string
//$1::type, $2::type, $3, etc
func (s *Snowflake) getCastClause(name string) string {
	castType, ok := s.sqlTypes[name]
	if ok {
		return "::" + castType.Type
	}

	return ""
}

//columnDDL returns column DDL (column name, mapped sql type)
func (s *Snowflake) columnDDL(name string, column Column) string {
	sqlColumnTypeDDL := column.SQLType
	overriddenSQLType, ok := s.sqlTypes[name]
	if ok {
		sqlColumnTypeDDL = overriddenSQLType.ColumnType
	}

	return fmt.Sprintf(`%s %s`, reformatValue(name), sqlColumnTypeDDL)
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

//Snowflake accepts names (identifiers) started with '_' or letter
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
