package adapters

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/server/uuid"
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

	sfMergeStatement = `MERGE INTO %s.%s USING (SELECT %s FROM %s.%s) %s ON %s WHEN MATCHED THEN UPDATE SET %s WHEN NOT MATCHED THEN INSERT (%s) VALUES (%s)`

	createSFDbSchemaIfNotExistsTemplate = `CREATE SCHEMA IF NOT EXISTS %s`
	addSFColumnTemplate                 = `ALTER TABLE %s.%s ADD COLUMN %s`
	createSFTableTemplate               = `CREATE TABLE %s.%s (%s)`
	insertSFTemplate                    = `INSERT INTO %s.%s (%s) VALUES %s`
	deleteSFTemplate                    = `DELETE FROM %s.%s.%s WHERE %s`
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

//CreateTable runs createTableInTransaction
func (s *Snowflake) CreateTable(tableSchema *Table) error {
	wrappedTx, err := s.OpenTx()
	if err != nil {
		return err
	}

	if err = s.createTableInTransaction(wrappedTx, tableSchema); err != nil {
		wrappedTx.Rollback()
		return fmt.Errorf("Error creating [%s] table: %v", tableSchema.Name, err)
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

// Insert inserts provided object into Snowflake
func (s *Snowflake) Insert(eventContext *EventContext) error {
	wrappedTx, err := s.OpenTx()
	if err != nil {
		return err
	}

	if err := s.insertInTransaction(wrappedTx, eventContext); err != nil {
		wrappedTx.Rollback()
		return err
	}

	return wrappedTx.DirectCommit()
}

//insertInTransaction inserts provided object into Snowflake in transaction
func (s *Snowflake) insertInTransaction(wrappedTx *Transaction, eventContext *EventContext) error {
	var columnNames, placeholders []string
	var values []interface{}
	for name, value := range eventContext.ProcessedEvent {
		columnNames = append(columnNames, reformatValue(name))

		castClause := s.getCastClause(name)
		placeholders = append(placeholders, "?"+castClause)
		values = append(values, value)
	}

	header := strings.Join(columnNames, ", ")
	placeholderStr := strings.Join(placeholders, ", ")

	query := fmt.Sprintf(insertSFTemplate, s.config.Schema, reformatValue(eventContext.Table.Name), header, "("+placeholderStr+")")
	s.queryLogger.LogQueryWithValues(query, values)

	_, err := wrappedTx.tx.ExecContext(s.ctx, query, values...)
	if err != nil {
		return fmt.Errorf("Error inserting in %s table with statement: %s values: %v: %v", eventContext.Table.Name, header, values, err)
	}

	return nil
}

//BulkInsert runs bulkInsertInTransaction
//returns error if occurred
func (s *Snowflake) BulkInsert(table *Table, objects []map[string]interface{}) error {
	wrappedTx, err := s.OpenTx()
	if err != nil {
		return err
	}

	err = s.bulkInsertInTransaction(wrappedTx, table, objects)
	if err != nil {
		wrappedTx.Rollback()
		return err
	}

	return wrappedTx.DirectCommit()
}

//BulkUpdate deletes with deleteConditions and runs bulkMergeInTransaction
//checks PKFields and uses bulkInsert or bulkMerge
//in bulkMerge - deduplicate objects
//if there are any duplicates, do the job 2 times
func (s *Snowflake) BulkUpdate(table *Table, objects []map[string]interface{}, deleteConditions *DeleteConditions) error {
	wrappedTx, err := s.OpenTx()
	if err != nil {
		return err
	}

	if !deleteConditions.IsEmpty() {
		if err := s.deleteInTransaction(wrappedTx, table, deleteConditions); err != nil {
			wrappedTx.Rollback()
			return err
		}
	}

	//deduplication for bulkMerge success (it fails if there is any duplicate)
	deduplicatedObjectsBuckets := deduplicateObjects(table, objects)

	for _, objectsBucket := range deduplicatedObjectsBuckets {
		if err := s.bulkMergeInTransaction(wrappedTx, table, objectsBucket); err != nil {
			wrappedTx.Rollback()
			return err
		}
	}

	return wrappedTx.DirectCommit()
}

//createTableInTransaction creates database table with name,columns provided in Table representation
func (s *Snowflake) createTableInTransaction(wrappedTx *Transaction, table *Table) error {
	var columnsDDL []string
	for columnName, column := range table.Columns {
		columnDDL := s.columnDDL(columnName, column)
		columnsDDL = append(columnsDDL, columnDDL)
	}

	//sorting columns asc
	sort.Strings(columnsDDL)
	query := fmt.Sprintf(createSFTableTemplate, s.config.Schema, reformatValue(table.Name), strings.Join(columnsDDL, ","))
	s.queryLogger.LogDDL(query)

	_, err := wrappedTx.tx.ExecContext(s.ctx, query)
	if err != nil {
		return fmt.Errorf("Error creating [%s] table: %v", table.Name, err)
	}

	return nil
}

//bulkInsertInTransaction inserts events in batches (insert into values (),(),())
func (s *Snowflake) bulkInsertInTransaction(wrappedTx *Transaction, table *Table, objects []map[string]interface{}) error {
	var placeholdersBuilder strings.Builder
	var unformattedColumnNames []string
	for name := range table.Columns {
		unformattedColumnNames = append(unformattedColumnNames, name)
	}
	maxValues := len(objects) * len(table.Columns)
	if maxValues > postgresValuesLimit {
		maxValues = postgresValuesLimit
	}
	valueArgs := make([]interface{}, 0, maxValues)
	for _, row := range objects {
		// if number of values exceeds limit, we have to execute insert query on processed rows
		if len(valueArgs)+len(unformattedColumnNames) > postgresValuesLimit {
			err := s.executeInsert(wrappedTx, table, unformattedColumnNames, removeLastComma(placeholdersBuilder.String()), valueArgs)
			if err != nil {
				return fmt.Errorf("Error executing insert: %v", err)
			}

			placeholdersBuilder.Reset()
			valueArgs = make([]interface{}, 0, maxValues)
		}
		_, err := placeholdersBuilder.WriteString("(")
		if err != nil {
			return fmt.Errorf(placeholdersStringBuildErrTemplate, err)
		}

		for i, column := range unformattedColumnNames {
			value, _ := row[column]
			valueArgs = append(valueArgs, value)
			castClause := s.getCastClause(column)

			_, err = placeholdersBuilder.WriteString("?" + castClause)
			if err != nil {
				return fmt.Errorf(placeholdersStringBuildErrTemplate, err)
			}

			if i < len(unformattedColumnNames)-1 {
				_, err = placeholdersBuilder.WriteString(",")
				if err != nil {
					return fmt.Errorf(placeholdersStringBuildErrTemplate, err)
				}
			}
		}
		_, err = placeholdersBuilder.WriteString("),")
		if err != nil {
			return fmt.Errorf(placeholdersStringBuildErrTemplate, err)
		}
	}

	if len(valueArgs) > 0 {
		err := s.executeInsert(wrappedTx, table, unformattedColumnNames, removeLastComma(placeholdersBuilder.String()), valueArgs)
		if err != nil {
			return fmt.Errorf("Error executing last insert in bulk: %v", err)
		}
	}

	return nil
}

//bulkMergeInTransaction uses temporary table and insert from select statement
func (s *Snowflake) bulkMergeInTransaction(wrappedTx *Transaction, table *Table, objects []map[string]interface{}) error {
	tmpTable := &Table{
		Name:           table.Name + "_tmp_" + uuid.NewLettersNumbers(),
		Columns:        table.Columns,
		PKFields:       map[string]bool{},
		DeletePkFields: false,
		Version:        0,
	}

	err := s.createTableInTransaction(wrappedTx, tmpTable)
	if err != nil {
		return fmt.Errorf("Error creating temporary table: %v", err)
	}

	err = s.bulkInsertInTransaction(wrappedTx, tmpTable, objects)
	if err != nil {
		return fmt.Errorf("Error inserting in temporary table: %v", err)
	}

	//insert from select
	var unformattedColumnNames []string
	var formattedColumnNames []string
	var updateSet []string
	var tmpPreffixColumnNames []string
	for name := range table.Columns {
		reformattedColumnName := reformatValue(name)
		unformattedColumnNames = append(unformattedColumnNames, name)
		formattedColumnNames = append(formattedColumnNames, reformattedColumnName)
		updateSet = append(updateSet, fmt.Sprintf("%s.%s = %s.%s", table.Name, reformattedColumnName, tmpTable.Name, reformattedColumnName))
		tmpPreffixColumnNames = append(tmpPreffixColumnNames, fmt.Sprintf("%s.%s", tmpTable.Name, reformattedColumnName))
	}

	var joinConditions []string
	for pkField := range table.PKFields {
		joinConditions = append(joinConditions, fmt.Sprintf("%s.%s = %s.%s", table.Name, pkField, tmpTable.Name, pkField))
	}

	insertFromSelectStatement := fmt.Sprintf(sfMergeStatement, s.config.Schema, table.Name, strings.Join(formattedColumnNames, ", "), s.config.Schema, tmpTable.Name,
		tmpTable.Name, strings.Join(joinConditions, " AND "), strings.Join(updateSet, ", "), strings.Join(formattedColumnNames, ", "), strings.Join(tmpPreffixColumnNames, ", "))

	s.queryLogger.LogQuery(insertFromSelectStatement)
	_, err = wrappedTx.tx.ExecContext(s.ctx, insertFromSelectStatement)
	if err != nil {
		return fmt.Errorf("Error merging rows: %v", err)
	}

	//delete tmp table
	return s.dropTableInTransaction(wrappedTx, tmpTable)
}

//dropTableInTransaction dropts a table in transaction
func (s *Snowflake) dropTableInTransaction(wrappedTx *Transaction, table *Table) error {
	query := fmt.Sprintf(dropTableTemplate, s.config.Schema, table.Name)
	s.queryLogger.LogDDL(query)

	_, err := wrappedTx.tx.ExecContext(s.ctx, query)

	if err != nil {
		return fmt.Errorf("Error dropping [%s] table: %v", table.Name, err)
	}

	return nil
}

//executeInsert execute insert with insertTemplate
func (s *Snowflake) executeInsert(wrappedTx *Transaction, table *Table, headerWithoutQuotes []string, placeholders string, valueArgs []interface{}) error {
	var quotedHeader []string
	for _, columnName := range headerWithoutQuotes {
		quotedHeader = append(quotedHeader, reformatValue(columnName))
	}

	statement := fmt.Sprintf(insertSFTemplate, s.config.Schema, table.Name, strings.Join(quotedHeader, ", "), placeholders)

	s.queryLogger.LogQueryWithValues(statement, valueArgs)

	if _, err := wrappedTx.tx.Exec(statement, valueArgs...); err != nil {
		return err
	}

	return nil
}

// deleteInTransaction deletes objects from Snowflake in transaction
func (s *Snowflake) deleteInTransaction(wrappedTx *Transaction, table *Table, deleteConditions *DeleteConditions) error {
	deleteCondition, values := s.toDeleteQuery(deleteConditions)
	query := fmt.Sprintf(deleteSFTemplate, s.config.Db, s.config.Schema, reformatValue(table.Name), deleteCondition)
	s.queryLogger.LogQueryWithValues(query, values)

	_, err := wrappedTx.tx.ExecContext(s.ctx, query, values...)
	if err != nil {
		return fmt.Errorf("Error deleting in %s table with statement: %s values: %v: %v", table.Name, deleteCondition, values, err)
	}

	return nil
}

func (s *Snowflake) toDeleteQuery(conditions *DeleteConditions) (string, []interface{}) {
	var queryConditions []string
	var values []interface{}

	for _, condition := range conditions.Conditions {
		conditionString := condition.Field + " " + condition.Clause + " ?"
		queryConditions = append(queryConditions, conditionString)
		values = append(values, condition.Value)
	}

	return strings.Join(queryConditions, conditions.JoinCondition), values
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
