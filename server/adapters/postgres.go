package adapters

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/typing"
	_ "github.com/lib/pq"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	postgresTableSchemaQuery = `SELECT 
 							pg_attribute.attname AS name,
    						pg_catalog.format_type(pg_attribute.atttypid,pg_attribute.atttypmod) AS column_type
						FROM pg_attribute
         					JOIN pg_class ON pg_class.oid = pg_attribute.attrelid
         					LEFT JOIN pg_attrdef pg_attrdef ON pg_attrdef.adrelid = pg_class.oid AND pg_attrdef.adnum = pg_attribute.attnum
         					LEFT JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
         					LEFT JOIN pg_constraint ON pg_constraint.conrelid = pg_class.oid AND pg_attribute.attnum = ANY (pg_constraint.conkey)
						WHERE pg_class.relkind = 'r'::char
  							AND  pg_namespace.nspname = $1
  							AND pg_class.relname = $2
  							AND pg_attribute.attnum > 0`
	postgresPrimaryKeyFieldsQuery = `SELECT
							pg_attribute.attname
						FROM pg_index, pg_class, pg_attribute, pg_namespace
						WHERE
								pg_class.oid = $1::regclass AND
								indrelid = pg_class.oid AND
								nspname = $2 AND
								pg_class.relnamespace = pg_namespace.oid AND
								pg_attribute.attrelid = pg_class.oid AND
								pg_attribute.attnum = any(pg_index.indkey)
					  	AND indisprimary`
	postgresCreateDbSchemaIfNotExistsTemplate = `CREATE SCHEMA IF NOT EXISTS "%s"`
	postgresAddColumnTemplate                 = `ALTER TABLE "%s"."%s" ADD COLUMN %s`
	postgresDropPrimaryKeyTemplate            = "ALTER TABLE %s.%s DROP CONSTRAINT %s"
	postgresAlterPrimaryKeyTemplate           = `ALTER TABLE "%s"."%s" ADD CONSTRAINT %s PRIMARY KEY (%s)`
	postgresCreateTableTemplate               = `CREATE TABLE "%s"."%s" (%s)`
	postgresInsertTemplate                    = `INSERT INTO "%s"."%s" (%s) VALUES %s`
	postgresMergeTemplate                     = `INSERT INTO "%s"."%s"(%s) VALUES %s ON CONFLICT ON CONSTRAINT %s DO UPDATE set %s;`
	postgresDeleteQueryTemplate               = `DELETE FROM "%s"."%s" WHERE %s`

	postgresCopyColumnTemplate   = `UPDATE "%s"."%s" SET %s = %s`
	postgresDropColumnTemplate   = `ALTER TABLE "%s"."%s" DROP COLUMN %s`
	postgresRenameColumnTemplate = `ALTER TABLE "%s"."%s" RENAME COLUMN %s TO %s`

	placeholdersStringBuildErrTemplate = `Error building placeholders string: %v`
	postgresValuesLimit                = 65535 // this is a limitation of parameters one can pass as query values. If more parameters are passed, error is returned
)

var (
	SchemaToPostgres = map[typing.DataType]string{
		typing.STRING:    "text",
		typing.INT64:     "bigint",
		typing.FLOAT64:   "numeric(38,18)",
		typing.TIMESTAMP: "timestamp",
		typing.BOOL:      "boolean",
		typing.UNKNOWN:   "text",
	}
)

//DataSourceConfig dto for deserialized datasource config (e.g. in Postgres or AwsRedshift destination)
type DataSourceConfig struct {
	Host       string            `mapstructure:"host" json:"host,omitempty" yaml:"host,omitempty"`
	Port       json.Number       `mapstructure:"port" json:"port,omitempty" yaml:"port,omitempty"`
	Db         string            `mapstructure:"db" json:"db,omitempty" yaml:"db,omitempty"`
	Schema     string            `mapstructure:"schema" json:"schema,omitempty" yaml:"schema,omitempty"`
	Username   string            `mapstructure:"username" json:"username,omitempty" yaml:"username,omitempty"`
	Password   string            `mapstructure:"password" json:"password,omitempty" yaml:"password,omitempty"`
	Parameters map[string]string `mapstructure:"parameters" json:"parameters,omitempty" yaml:"parameters,omitempty"`
}

//Validate required fields in DataSourceConfig
func (dsc *DataSourceConfig) Validate() error {
	if dsc == nil {
		return errors.New("Datasource config is required")
	}
	if dsc.Host == "" {
		return errors.New("Datasource host is required parameter")
	}
	if dsc.Db == "" {
		return errors.New("Datasource db is required parameter")
	}
	if dsc.Username == "" {
		return errors.New("Datasource username is required parameter")
	}

	if dsc.Parameters == nil {
		dsc.Parameters = map[string]string{}
	}
	return nil
}

//Postgres is adapter for creating,patching (schema or table), inserting data to postgres
type Postgres struct {
	ctx         context.Context
	config      *DataSourceConfig
	dataSource  *sql.DB
	queryLogger *logging.QueryLogger

	sqlTypes typing.SQLTypes
}

//NewPostgresUnderRedshift returns configured Postgres adapter instance without mapping old types
func NewPostgresUnderRedshift(ctx context.Context, config *DataSourceConfig, queryLogger *logging.QueryLogger, sqlTypes typing.SQLTypes) (*Postgres, error) {
	connectionString := fmt.Sprintf("host=%s port=%s dbname=%s user=%s password=%s ",
		config.Host, config.Port.String(), config.Db, config.Username, config.Password)
	//concat provided connection parameters
	for k, v := range config.Parameters {
		connectionString += k + "=" + v + " "
	}
	dataSource, err := sql.Open("postgres", connectionString)
	if err != nil {
		return nil, err
	}

	if err := dataSource.Ping(); err != nil {
		dataSource.Close()
		return nil, err
	}

	//set default value
	dataSource.SetConnMaxLifetime(10 * time.Minute)

	return &Postgres{ctx: ctx, config: config, dataSource: dataSource, queryLogger: queryLogger, sqlTypes: sqlTypes}, nil
}

//NewPostgres return configured Postgres adapter instance
func NewPostgres(ctx context.Context, config *DataSourceConfig, queryLogger *logging.QueryLogger, sqlTypes typing.SQLTypes) (*Postgres, error) {
	connectionString := fmt.Sprintf("host=%s port=%s dbname=%s user=%s password=%s ",
		config.Host, config.Port.String(), config.Db, config.Username, config.Password)
	//concat provided connection parameters
	for k, v := range config.Parameters {
		connectionString += k + "=" + v + " "
	}
	dataSource, err := sql.Open("postgres", connectionString)
	if err != nil {
		return nil, err
	}

	if err := dataSource.Ping(); err != nil {
		dataSource.Close()
		return nil, err
	}

	//set default value
	dataSource.SetConnMaxLifetime(10 * time.Minute)

	return &Postgres{ctx: ctx, config: config, dataSource: dataSource, queryLogger: queryLogger, sqlTypes: reformatMappings(sqlTypes, SchemaToPostgres)}, nil
}

//Type returns Postgres type
func (Postgres) Type() string {
	return "Postgres"
}

//OpenTx opens underline sql transaction and return wrapped instance
func (p *Postgres) OpenTx() (*Transaction, error) {
	tx, err := p.dataSource.BeginTx(p.ctx, nil)
	if err != nil {
		return nil, err
	}

	return &Transaction{tx: tx, dbType: p.Type()}, nil
}

//CreateDbSchema creates database schema instance if doesn't exist
func (p *Postgres) CreateDbSchema(dbSchemaName string) error {
	wrappedTx, err := p.OpenTx()
	if err != nil {
		return err
	}

	return createDbSchemaInTransaction(p.ctx, wrappedTx, postgresCreateDbSchemaIfNotExistsTemplate, dbSchemaName, p.queryLogger)
}

//CreateTable creates database table with name,columns provided in Table representation
func (p *Postgres) CreateTable(table *Table) error {
	wrappedTx, err := p.OpenTx()
	if err != nil {
		return err
	}

	return p.createTableInTransaction(wrappedTx, table)
}

//PatchTableSchema adds new columns(from provided Table) to existing table
func (p *Postgres) PatchTableSchema(patchTable *Table) error {
	wrappedTx, err := p.OpenTx()
	if err != nil {
		return err
	}

	return p.patchTableSchemaInTransaction(wrappedTx, patchTable)
}

//GetTableSchema returns table (name,columns with name and types) representation wrapped in Table struct
func (p *Postgres) GetTableSchema(tableName string) (*Table, error) {
	table, err := p.getTable(tableName)
	if err != nil {
		return nil, err
	}

	//don't select primary keys of non-existent table
	if len(table.Columns) == 0 {
		return table, nil
	}

	pkFields, err := p.getPrimaryKeys(tableName)
	if err != nil {
		return nil, err
	}

	table.PKFields = pkFields
	return table, nil
}

//Insert provided object in postgres with typecasts
//uses upsert (merge on conflict) if primary_keys are configured
func (p *Postgres) Insert(eventContext *EventContext) error {
	columnsWithoutQuotes, columnsWithQuotes, placeholders, values := p.buildInsertPayload(eventContext.ProcessedEvent)

	var statement string
	if len(eventContext.Table.PKFields) == 0 {
		statement = fmt.Sprintf(postgresInsertTemplate, p.config.Schema, eventContext.Table.Name, strings.Join(columnsWithQuotes, ", "), "("+strings.Join(placeholders, ", ")+")")
	} else {
		statement = fmt.Sprintf(postgresMergeTemplate, p.config.Schema, eventContext.Table.Name, strings.Join(columnsWithQuotes, ","), "("+strings.Join(placeholders, ", ")+")", buildConstraintName(p.config.Schema, eventContext.Table.Name), p.buildUpdateSection(columnsWithoutQuotes))
	}

	p.queryLogger.LogQueryWithValues(statement, values)

	_, err := p.dataSource.ExecContext(p.ctx, statement, values...)
	if err != nil {
		return fmt.Errorf("Error inserting in %s table with statement: %s values: %v: %v", eventContext.Table.Name, statement, values, err)
	}

	return nil
}

func (p *Postgres) getTable(tableName string) (*Table, error) {
	table := &Table{Name: tableName, Columns: map[string]Column{}, PKFields: map[string]bool{}}
	rows, err := p.dataSource.QueryContext(p.ctx, postgresTableSchemaQuery, p.config.Schema, tableName)
	if err != nil {
		return nil, fmt.Errorf("Error querying table [%s] schema: %v", tableName, err)
	}

	defer rows.Close()
	for rows.Next() {
		var columnName, columnPostgresType string
		if err := rows.Scan(&columnName, &columnPostgresType); err != nil {
			return nil, fmt.Errorf("Error scanning result: %v", err)
		}
		if columnPostgresType == "-" {
			//skip dropped postgres field
			continue
		}

		table.Columns[columnName] = Column{SQLType: columnPostgresType}
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("Last rows.Err: %v", err)
	}

	return table, nil
}

//create table columns and pk key
//override input table sql type with configured cast type
//make fields from Table PkFields - 'not null'
func (p *Postgres) createTableInTransaction(wrappedTx *Transaction, table *Table) error {
	var columnsDDL []string
	pkFields := table.GetPKFieldsMap()
	for columnName, column := range table.Columns {
		columnsDDL = append(columnsDDL, p.columnDDL(columnName, column, pkFields))
	}

	//sorting columns asc
	sort.Strings(columnsDDL)
	query := fmt.Sprintf(postgresCreateTableTemplate, p.config.Schema, table.Name, strings.Join(columnsDDL, ", "))
	p.queryLogger.LogDDL(query)

	_, err := wrappedTx.tx.ExecContext(p.ctx, query)

	if err != nil {
		wrappedTx.Rollback()
		return fmt.Errorf("Error creating [%s] table: %v", table.Name, err)
	}

	err = p.createPrimaryKeyInTransaction(wrappedTx, table)
	if err != nil {
		wrappedTx.Rollback()
		return err
	}

	return wrappedTx.tx.Commit()
}

//alter table with columns (if not empty)
//recreate primary key (if not empty) or delete primary key if Table.DeletePkFields is true
func (p *Postgres) patchTableSchemaInTransaction(wrappedTx *Transaction, patchTable *Table) error {
	pkFields := patchTable.GetPKFieldsMap()
	//patch columns
	for columnName, column := range patchTable.Columns {
		columnDDL := p.columnDDL(columnName, column, pkFields)
		query := fmt.Sprintf(postgresAddColumnTemplate, p.config.Schema, patchTable.Name, columnDDL)
		p.queryLogger.LogDDL(query)

		_, err := wrappedTx.tx.ExecContext(p.ctx, query)
		if err != nil {
			wrappedTx.Rollback()
			return fmt.Errorf("Error patching %s table with [%s] DDL: %v", patchTable.Name, columnDDL, err)
		}
	}

	//patch primary keys - delete old
	if patchTable.DeletePkFields {
		err := p.deletePrimaryKeyInTransaction(wrappedTx, patchTable)
		if err != nil {
			wrappedTx.Rollback()
			return err
		}
	}

	//patch primary keys - create new
	if len(patchTable.PKFields) > 0 {
		err := p.createPrimaryKeyInTransaction(wrappedTx, patchTable)
		if err != nil {
			wrappedTx.Rollback()
			return err
		}
	}

	return wrappedTx.DirectCommit()
}

//createPrimaryKeyInTransaction create primary key constraint
func (p *Postgres) createPrimaryKeyInTransaction(wrappedTx *Transaction, table *Table) error {
	if len(table.PKFields) == 0 {
		return nil
	}

	var quotedColumnNames []string
	for _, column := range table.GetPKFields() {
		quotedColumnNames = append(quotedColumnNames, fmt.Sprintf(`"%s"`, column))
	}

	statement := fmt.Sprintf(postgresAlterPrimaryKeyTemplate,
		p.config.Schema, table.Name, buildConstraintName(p.config.Schema, table.Name), strings.Join(quotedColumnNames, ","))
	p.queryLogger.LogDDL(statement)

	_, err := wrappedTx.tx.ExecContext(p.ctx, statement)
	if err != nil {
		return fmt.Errorf("Error setting primary key [%s] %s table: %v", strings.Join(table.GetPKFields(), ","), table.Name, err)
	}

	return nil
}

//delete primary key
func (p *Postgres) deletePrimaryKeyInTransaction(wrappedTx *Transaction, table *Table) error {
	query := fmt.Sprintf(postgresDropPrimaryKeyTemplate, p.config.Schema, table.Name, buildConstraintName(p.config.Schema, table.Name))
	p.queryLogger.LogDDL(query)
	_, err := wrappedTx.tx.ExecContext(p.ctx, query)
	if err != nil {
		return fmt.Errorf("Failed to drop primary key constraint for table %s.%s: %v", p.config.Schema, table.Name, err)
	}

	return nil
}

//BulkInsert runs bulkStoreInTransaction
func (p *Postgres) BulkInsert(table *Table, objects []map[string]interface{}) error {
	wrappedTx, err := p.OpenTx()
	if err != nil {
		return err
	}

	if err = p.bulkStoreInTransaction(wrappedTx, table, objects); err != nil {
		wrappedTx.Rollback()
		return err
	}

	return wrappedTx.DirectCommit()
}

//BulkUpdate deletes with deleteConditions and runs bulkStoreInTransaction
func (p *Postgres) BulkUpdate(table *Table, objects []map[string]interface{}, deleteConditions *DeleteConditions) error {
	wrappedTx, err := p.OpenTx()
	if err != nil {
		return err
	}

	if !deleteConditions.IsEmpty() {
		err := p.deleteInTransaction(wrappedTx, table, deleteConditions)
		if err != nil {
			wrappedTx.Rollback()
			return err
		}
	}

	if err := p.bulkStoreInTransaction(wrappedTx, table, objects); err != nil {
		wrappedTx.Rollback()
		return err
	}
	return wrappedTx.DirectCommit()
}

func (p *Postgres) bulkStoreInTransaction(wrappedTx *Transaction, table *Table, objects []map[string]interface{}) error {
	if len(table.PKFields) == 0 {
		return p.bulkInsertInTransaction(wrappedTx, table, objects)
	}

	return p.bulkMergeInTransaction(wrappedTx, table, objects)
}

//Must be used when table has no primary keys. Inserts data in batches to improve performance.
//Prefer to use bulkStoreInTransaction instead of calling this method directly
func (p *Postgres) bulkInsertInTransaction(wrappedTx *Transaction, table *Table, objects []map[string]interface{}) error {
	var placeholdersBuilder strings.Builder
	var headerWithoutQuotes []string
	for name := range table.Columns {
		headerWithoutQuotes = append(headerWithoutQuotes, name)
	}
	maxValues := len(objects) * len(table.Columns)
	if maxValues > postgresValuesLimit {
		maxValues = postgresValuesLimit
	}
	valueArgs := make([]interface{}, 0, maxValues)
	placeholdersCounter := 1
	for _, row := range objects {
		// if number of values exceeds limit, we have to execute insert query on processed rows
		if len(valueArgs)+len(headerWithoutQuotes) > postgresValuesLimit {
			err := p.executeInsert(wrappedTx, table, headerWithoutQuotes, removeLastComma(placeholdersBuilder.String()), valueArgs)
			if err != nil {
				return fmt.Errorf("Error executing insert: %v", err)
			}

			placeholdersBuilder.Reset()
			placeholdersCounter = 1
			valueArgs = make([]interface{}, 0, maxValues)
		}
		_, err := placeholdersBuilder.WriteString("(")
		if err != nil {
			return fmt.Errorf(placeholdersStringBuildErrTemplate, err)
		}

		for i, column := range headerWithoutQuotes {
			value, _ := row[column]
			valueArgs = append(valueArgs, value)
			castClause := p.getCastClause(column)

			_, err = placeholdersBuilder.WriteString("$" + strconv.Itoa(placeholdersCounter) + castClause)
			if err != nil {
				return fmt.Errorf(placeholdersStringBuildErrTemplate, err)
			}

			if i < len(headerWithoutQuotes)-1 {
				_, err = placeholdersBuilder.WriteString(",")
				if err != nil {
					return fmt.Errorf(placeholdersStringBuildErrTemplate, err)
				}
			}
			placeholdersCounter++
		}
		_, err = placeholdersBuilder.WriteString("),")
		if err != nil {
			return fmt.Errorf(placeholdersStringBuildErrTemplate, err)
		}
	}
	if len(valueArgs) > 0 {
		err := p.executeInsert(wrappedTx, table, headerWithoutQuotes, removeLastComma(placeholdersBuilder.String()), valueArgs)
		if err != nil {
			return fmt.Errorf("Error executing last insert in bulk: %v", err)
		}
	}
	return nil
}

//Must be used only if table has primary key fields. Slower than bulkInsert as each query executed separately.
//Prefer to use bulkStoreInTransaction instead of calling this method directly
func (p *Postgres) bulkMergeInTransaction(wrappedTx *Transaction, table *Table, objects []map[string]interface{}) error {
	var placeholders string
	var headerWithoutQuotes []string
	var headerWithQuotes []string
	i := 1
	for name := range table.Columns {
		headerWithoutQuotes = append(headerWithoutQuotes, name)
		headerWithQuotes = append(headerWithQuotes, fmt.Sprintf(`"%s"`, name))

		placeholders += "$" + strconv.Itoa(i) + p.getCastClause(name) + ","

		i++
	}
	placeholders = "(" + removeLastComma(placeholders) + ")"

	statement := fmt.Sprintf(postgresMergeTemplate, p.config.Schema, table.Name, strings.Join(headerWithQuotes, ","), placeholders, buildConstraintName(p.config.Schema, table.Name), p.buildUpdateSection(headerWithoutQuotes))
	mergeStmt, err := wrappedTx.tx.PrepareContext(p.ctx, statement)
	if err != nil {
		return fmt.Errorf("Error preparing bulk merge statement [%s] table %s statement: %v", statement, table.Name, err)
	}

	for _, row := range objects {
		var values []interface{}
		for _, column := range headerWithoutQuotes {
			value, _ := row[column]
			values = append(values, value)
		}

		p.queryLogger.LogQueryWithValues(statement, values)
		_, err = mergeStmt.ExecContext(p.ctx, values...)
		if err != nil {
			return fmt.Errorf("Error bulk merging in %s table with statement: %s values: %v: %v", table.Name, statement, values, err)
		}
	}

	return nil
}

func (p *Postgres) deleteInTransaction(wrappedTx *Transaction, table *Table, deleteConditions *DeleteConditions) error {
	deleteCondition, values := p.toDeleteQuery(deleteConditions)
	query := fmt.Sprintf(postgresDeleteQueryTemplate, p.config.Schema, table.Name, deleteCondition)
	p.queryLogger.LogQueryWithValues(query, values)

	if _, err := wrappedTx.tx.ExecContext(p.ctx, query, values...); err != nil {
		return fmt.Errorf("Error deleting using query: %s, error: %v", query, err)
	}

	return nil
}

func (p *Postgres) toDeleteQuery(conditions *DeleteConditions) (string, []interface{}) {
	var queryConditions []string
	var values []interface{}
	for i, condition := range conditions.Conditions {
		queryConditions = append(queryConditions, condition.Field+" "+condition.Clause+" $"+strconv.Itoa(i+1)+p.getCastClause(condition.Field))
		values = append(values, condition.Value)
	}
	return strings.Join(queryConditions, conditions.JoinCondition), values
}

//executeInsert execute insert with postgresInsertTemplate
func (p *Postgres) executeInsert(wrappedTx *Transaction, table *Table, headerWithoutQuotes []string, placeholders string, valueArgs []interface{}) error {
	var quotedHeader []string
	for _, columnName := range headerWithoutQuotes {
		quotedHeader = append(quotedHeader, fmt.Sprintf(`"%s"`, columnName))
	}

	statement := fmt.Sprintf(postgresInsertTemplate, p.config.Schema, table.Name, strings.Join(quotedHeader, ","), placeholders)

	p.queryLogger.LogQueryWithValues(statement, valueArgs)

	if _, err := wrappedTx.tx.Exec(statement, valueArgs...); err != nil {
		return err
	}

	return nil
}

//columnDDL returns column DDL (quoted column name, mapped sql type and 'not null' if pk field)
func (p *Postgres) columnDDL(name string, column Column, pkFields map[string]bool) string {
	var notNullClause string
	sqlType := column.SQLType

	if overriddenSQLType, ok := p.sqlTypes[name]; ok {
		sqlType = overriddenSQLType.ColumnType
	}

	//not null
	if _, ok := pkFields[name]; ok {
		notNullClause = " not null " + p.getDefaultValueStatement(sqlType)
	}

	return fmt.Sprintf(`"%s" %s%s`, name, sqlType, notNullClause)
}

//getCastClause returns ::SQL_TYPE clause or empty string
//$1::type, $2::type, $3, etc
func (p *Postgres) getCastClause(name string) string {
	castType, ok := p.sqlTypes[name]
	if ok {
		return "::" + castType.Type
	}

	return ""
}

//return default value statement for creating column
func (p *Postgres) getDefaultValueStatement(sqlType string) string {
	//get default value based on type
	if strings.Contains(sqlType, "var") || strings.Contains(sqlType, "text") {
		return "default ''"
	}

	return "default 0"
}

//Close underlying sql.DB
func (p *Postgres) Close() error {
	return p.dataSource.Close()
}

func buildConstraintName(schemaName string, tableName string) string {
	return schemaName + "_" + tableName + "_pk"
}

func (p *Postgres) getPrimaryKeys(tableName string) (map[string]bool, error) {
	primaryKeys := map[string]bool{}
	pkFieldsRows, err := p.dataSource.QueryContext(p.ctx, postgresPrimaryKeyFieldsQuery, p.config.Schema+"."+tableName, p.config.Schema)
	if err != nil {
		return nil, fmt.Errorf("Error querying primary keys for [%s.%s] table: %v", p.config.Schema, tableName, err)
	}

	defer pkFieldsRows.Close()
	var pkFields []string
	for pkFieldsRows.Next() {
		var fieldName string
		if err := pkFieldsRows.Scan(&fieldName); err != nil {
			return nil, fmt.Errorf("error scanning primary key result: %v", err)
		}
		pkFields = append(pkFields, fieldName)
	}
	if err := pkFieldsRows.Err(); err != nil {
		return nil, fmt.Errorf("pk last rows.Err: %v", err)
	}
	for _, field := range pkFields {
		primaryKeys[field] = true
	}

	return primaryKeys, nil
}

//buildInsertPayload returns
// 1. column names slice
// 2. quoted column names slice
// 2. placeholders slice
// 3. values slice
func (p *Postgres) buildInsertPayload(valuesMap map[string]interface{}) ([]string, []string, []string, []interface{}) {
	header := make([]string, len(valuesMap), len(valuesMap))
	quotedHeader := make([]string, len(valuesMap), len(valuesMap))
	placeholders := make([]string, len(valuesMap), len(valuesMap))
	values := make([]interface{}, len(valuesMap), len(valuesMap))
	i := 0
	for name, value := range valuesMap {
		quotedHeader[i] = fmt.Sprintf(`"%s"`, name)
		header[i] = name

		//$1::type, $2::type, $3, etc ($0 - wrong)
		placeholders[i] = fmt.Sprintf("$%d%s", i+1, p.getCastClause(name))
		values[i] = value
		i++
	}

	return header, quotedHeader, placeholders, values
}

//buildUpdateSection returns value for merge update statement ("col1"=$1, "col2"=$2)
func (p *Postgres) buildUpdateSection(header []string) string {
	var updateColumns []string
	for i, columnName := range header {
		updateColumns = append(updateColumns, fmt.Sprintf(`"%s"=$%d`, columnName, i+1))
	}
	return strings.Join(updateColumns, ",")
}

//create database and commit transaction
func createDbSchemaInTransaction(ctx context.Context, wrappedTx *Transaction, statementTemplate,
	dbSchemaName string, queryLogger *logging.QueryLogger) error {
	query := fmt.Sprintf(statementTemplate, dbSchemaName)
	queryLogger.LogDDL(query)
	createStmt, err := wrappedTx.tx.PrepareContext(ctx, query)
	if err != nil {
		wrappedTx.Rollback()
		return fmt.Errorf("Error preparing create db schema %s statement: %v", dbSchemaName, err)
	}

	_, err = createStmt.ExecContext(ctx)

	if err != nil {
		wrappedTx.Rollback()
		return fmt.Errorf("Error creating [%s] db schema: %v", dbSchemaName, err)
	}

	return wrappedTx.tx.Commit()
}

//reformatMappings handles old (deprecated) mapping types //TODO remove someday
//put sql types as is
//if mapping type is inner => map with sql type
func reformatMappings(mappingTypeCasts typing.SQLTypes, dbTypes map[typing.DataType]string) typing.SQLTypes {
	formattedSqlTypes := typing.SQLTypes{}
	for column, sqlType := range mappingTypeCasts {
		var columnType, columnStatement typing.DataType
		var err error

		columnType, err = typing.TypeFromString(sqlType.Type)
		if err != nil {
			formattedSqlTypes[column] = sqlType
			continue
		}

		columnStatement, err = typing.TypeFromString(sqlType.ColumnType)
		if err != nil {
			formattedSqlTypes[column] = sqlType
			continue
		}

		dbSQLType, _ := dbTypes[columnType]
		dbColumnType, _ := dbTypes[columnStatement]
		formattedSqlTypes[column] = typing.SQLColumn{
			Type:       dbSQLType,
			ColumnType: dbColumnType,
		}
	}

	return formattedSqlTypes
}

func removeLastComma(str string) string {
	if last := len(str) - 1; last >= 0 && str[last] == ',' {
		str = str[:last]
	}

	return str
}
