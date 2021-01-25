package adapters

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/typing"
	_ "github.com/lib/pq"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	tableNamesQuery  = `SELECT table_name FROM information_schema.tables WHERE table_schema=$1`
	tableSchemaQuery = `SELECT 
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
	primaryKeyFieldsQuery = `SELECT
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
	createDbSchemaIfNotExistsTemplate = `CREATE SCHEMA IF NOT EXISTS "%s"`
	addColumnTemplate                 = `ALTER TABLE "%s"."%s" ADD COLUMN %s %s`
	dropPrimaryKeyTemplate            = "ALTER TABLE %s.%s DROP CONSTRAINT IF EXISTS %s"
	alterPrimaryKeyTemplate           = `ALTER TABLE "%s"."%s" ADD CONSTRAINT %s PRIMARY KEY (%s)`
	createTableTemplate               = `CREATE TABLE "%s"."%s" (%s)`
	insertTemplate                    = `INSERT INTO "%s"."%s" (%s) VALUES %s`
	mergeTemplate                     = `INSERT INTO %s.%s(%s) VALUES %s ON CONFLICT ON CONSTRAINT %s DO UPDATE set %s;`
	deleteQueryTemplate               = `DELETE FROM %s.%s WHERE %s`

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
	Port       int               `mapstructure:"port" json:"port,omitempty" yaml:"port,omitempty"`
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

	mappingTypeCasts map[string]string
}

//NewPostgresUnderRedshift return configured Postgres adapter instance without mapping old types
func NewPostgresUnderRedshift(ctx context.Context, config *DataSourceConfig, queryLogger *logging.QueryLogger, mappingTypeCasts map[string]string) (*Postgres, error) {
	connectionString := fmt.Sprintf("host=%s port=%d dbname=%s user=%s password=%s ",
		config.Host, config.Port, config.Db, config.Username, config.Password)
	//concat provided connection parameters
	for k, v := range config.Parameters {
		connectionString += k + "=" + v + " "
	}
	dataSource, err := sql.Open("postgres", connectionString)

	if err != nil {
		return nil, err
	}
	if err := dataSource.Ping(); err != nil {
		return nil, err
	}

	return &Postgres{ctx: ctx, config: config, dataSource: dataSource, queryLogger: queryLogger, mappingTypeCasts: mappingTypeCasts}, nil
}

//NewPostgres return configured Postgres adapter instance
func NewPostgres(ctx context.Context, config *DataSourceConfig, queryLogger *logging.QueryLogger, mappingTypeCasts map[string]string) (*Postgres, error) {
	connectionString := fmt.Sprintf("host=%s port=%d dbname=%s user=%s password=%s ",
		config.Host, config.Port, config.Db, config.Username, config.Password)
	//concat provided connection parameters
	for k, v := range config.Parameters {
		connectionString += k + "=" + v + " "
	}
	dataSource, err := sql.Open("postgres", connectionString)

	if err != nil {
		return nil, err
	}
	if err := dataSource.Ping(); err != nil {
		return nil, err
	}

	return &Postgres{ctx: ctx, config: config, dataSource: dataSource, queryLogger: queryLogger, mappingTypeCasts: reformatMappings(mappingTypeCasts, SchemaToPostgres)}, nil
}

func (Postgres) Name() string {
	return "Postgres"
}

//OpenTx open underline sql transaction and return wrapped instance
func (p *Postgres) OpenTx() (*Transaction, error) {
	tx, err := p.dataSource.BeginTx(p.ctx, nil)
	if err != nil {
		return nil, err
	}

	return &Transaction{tx: tx, dbType: p.Name()}, nil
}

//CreateDbSchema create database schema instance if doesn't exist
func (p *Postgres) CreateDbSchema(dbSchemaName string) error {
	wrappedTx, err := p.OpenTx()
	if err != nil {
		return err
	}

	return createDbSchemaInTransaction(p.ctx, wrappedTx, createDbSchemaIfNotExistsTemplate, dbSchemaName, p.queryLogger)
}

//CreateTable create database table with name,columns provided in Table representation
func (p *Postgres) CreateTable(table *Table) error {
	wrappedTx, err := p.OpenTx()
	if err != nil {
		return err
	}

	return p.createTableInTransaction(wrappedTx, table)
}

//PatchTableSchema add new columns(from provided Table) to existing table
func (p *Postgres) PatchTableSchema(patchTable *Table) error {
	wrappedTx, err := p.OpenTx()
	if err != nil {
		return err
	}

	return p.patchTableSchemaInTransaction(wrappedTx, patchTable)
}

//GetTableSchema return table (name,columns with name and types) representation wrapped in Table struct
func (p *Postgres) GetTableSchema(tableName string) (*Table, error) {
	table, err := p.getTable(tableName)
	if err != nil {
		return nil, err
	}

	//don't select primary keys of non-existent table
	if len(table.Columns) == 0 {
		return table, nil
	}

	pkFieldsRows, err := p.dataSource.QueryContext(p.ctx, primaryKeyFieldsQuery, p.config.Schema+"."+tableName, p.config.Schema)
	if err != nil {
		return nil, fmt.Errorf("error querying primary keys for [%s.%s] schema: %v", p.config.Schema, tableName, err)
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
		table.PKFields[field] = true
	}

	return table, nil
}

func (p *Postgres) getTable(tableName string) (*Table, error) {
	table := &Table{Name: tableName, Columns: map[string]Column{}, PKFields: map[string]bool{}}
	rows, err := p.dataSource.QueryContext(p.ctx, tableSchemaQuery, p.config.Schema, tableName)
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

		table.Columns[columnName] = Column{SqlType: columnPostgresType}
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("Last rows.Err: %v", err)
	}

	return table, nil
}

//create table columns and pk key
//override input table sql type with configured cast type
func (p *Postgres) createTableInTransaction(wrappedTx *Transaction, table *Table) error {
	var columnsDDL []string
	for columnName, column := range table.Columns {
		sqlType := column.SqlType
		castedSqlType, ok := p.mappingTypeCasts[columnName]
		if ok {
			sqlType = castedSqlType
		}
		columnsDDL = append(columnsDDL, fmt.Sprintf(`%s %s`, columnName, sqlType))
	}

	//sorting columns asc
	sort.Strings(columnsDDL)
	query := fmt.Sprintf(createTableTemplate, p.config.Schema, table.Name, strings.Join(columnsDDL, ","))
	p.queryLogger.LogDDL(query)
	createStmt, err := wrappedTx.tx.PrepareContext(p.ctx, query)
	if err != nil {
		wrappedTx.Rollback()
		return fmt.Errorf("Error preparing create table %s statement: %v", table.Name, err)
	}

	_, err = createStmt.ExecContext(p.ctx)

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
	//patch columns
	for columnName, column := range patchTable.Columns {
		sqlType := column.SqlType
		castedSqlType, ok := p.mappingTypeCasts[columnName]
		if ok {
			sqlType = castedSqlType
		}
		query := fmt.Sprintf(addColumnTemplate, p.config.Schema, patchTable.Name, columnName, sqlType)
		p.queryLogger.LogDDL(query)

		alterStmt, err := wrappedTx.tx.PrepareContext(p.ctx, query)
		if err != nil {
			wrappedTx.Rollback()
			return fmt.Errorf("Error preparing patching table %s schema statement: %v", patchTable.Name, err)
		}

		_, err = alterStmt.ExecContext(p.ctx)
		if err != nil {
			wrappedTx.Rollback()
			return fmt.Errorf("Error patching %s table with '%s' - %s column schema: %v", patchTable.Name, columnName, column.SqlType, err)
		}
	}

	//patch primary keys - delete old
	if len(patchTable.PKFields) > 0 || patchTable.DeletePkFields {
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

//create primary key
func (p *Postgres) createPrimaryKeyInTransaction(wrappedTx *Transaction, table *Table) error {
	if len(table.PKFields) == 0 {
		return nil
	}

	query := fmt.Sprintf(alterPrimaryKeyTemplate,
		p.config.Schema, table.Name, buildConstraintName(p.config.Schema, table.Name), strings.Join(table.GetPKFields(), ","))
	p.queryLogger.LogDDL(query)
	alterConstraintStmt, err := wrappedTx.tx.PrepareContext(p.ctx, query)
	if err != nil {
		return fmt.Errorf("Error preparing primary key setting to table %s: %v", table.Name, err)
	}
	_, err = alterConstraintStmt.ExecContext(p.ctx)
	if err != nil {
		return fmt.Errorf("Error setting primary key %s table: %v", table.Name, err)
	}

	return nil
}

//delete primary key
func (p *Postgres) deletePrimaryKeyInTransaction(wrappedTx *Transaction, table *Table) error {
	query := fmt.Sprintf(dropPrimaryKeyTemplate, p.config.Schema, table.Name, buildConstraintName(p.config.Schema, table.Name))
	p.queryLogger.LogDDL(query)
	dropPKStmt, err := wrappedTx.tx.PrepareContext(p.ctx, query)
	if err != nil {
		return fmt.Errorf("failed to prepare statement to drop primary key for table %s: %v", table.Name, err)
	}
	_, err = dropPKStmt.ExecContext(p.ctx)
	if err != nil {
		return fmt.Errorf("failed to drop primary key constraint for table %s: %v", table.Name, err)
	}

	return nil
}

//Insert provided object in postgres with typecasts
func (p *Postgres) Insert(table *Table, valuesMap map[string]interface{}) error {
	var header string
	placeholders := "("
	var values []interface{}
	i := 1
	for name, value := range valuesMap {
		header += name + ","
		//$1::type, $2::type, $3, etc
		placeholders += "$" + strconv.Itoa(i) + p.castClause(name) + ","
		values = append(values, value)
		i++
	}

	header = removeLastComma(header)
	placeholders = removeLastComma(placeholders)
	placeholders += ")"
	query := p.insertQuery(table.GetPKFields(), table.Name, header, placeholders)
	p.queryLogger.LogQueryWithValues(query, values)

	wrappedTx, err := p.OpenTx()
	if err != nil {
		return err
	}
	insertStmt, err := wrappedTx.tx.PrepareContext(p.ctx, query)
	if err != nil {
		wrappedTx.Rollback()
		return fmt.Errorf("Error preparing insert table %s statement: %v", table.Name, err)
	}

	_, err = insertStmt.ExecContext(p.ctx, values...)
	if err != nil {
		wrappedTx.Rollback()
		return fmt.Errorf("Error inserting in %s table with statement: %s values: %v: %v", table.Name, header, values, err)
	}

	return wrappedTx.DirectCommit()
}

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

	if err := p.insertInTransaction(wrappedTx, table, objects); err != nil {
		wrappedTx.Rollback()
		return err
	}
	return wrappedTx.DirectCommit()
}

func (p *Postgres) deleteInTransaction(wrappedTx *Transaction, table *Table, deleteConditions *DeleteConditions) error {
	deleteCondition, values := p.toDeleteQuery(deleteConditions)
	query := fmt.Sprintf(deleteQueryTemplate, p.config.Schema, table.Name, deleteCondition)
	p.queryLogger.LogQueryWithValues(query, values)
	deleteStmt, err := wrappedTx.tx.PrepareContext(p.ctx, query)
	if err != nil {
		return fmt.Errorf("Error preparing delete table %s statement: %v", table.Name, err)
	}
	_, err = deleteStmt.ExecContext(p.ctx, values...)
	if err != nil {
		return fmt.Errorf("Error deleting using query: %s:, error: %v", query, err)
	}
	return nil
}

func (p *Postgres) toDeleteQuery(conditions *DeleteConditions) (string, []interface{}) {
	var queryConditions []string
	var values []interface{}
	for i, condition := range conditions.Conditions {
		queryConditions = append(queryConditions, condition.Field+" "+condition.Clause+" $"+strconv.Itoa(i+1)+p.castClause(condition.Field))
		values = append(values, condition.Value)
	}
	return strings.Join(queryConditions, conditions.JoinCondition), values
}

func (p *Postgres) castClause(field string) string {
	castClause := ""
	castType, ok := p.mappingTypeCasts[field]
	if ok {
		castClause = "::" + castType
	}
	return castClause
}

//BulkInsert insert objects into table in one prepared statement
func (p *Postgres) BulkInsert(table *Table, objects []map[string]interface{}) error {
	wrappedTx, err := p.OpenTx()
	if err != nil {
		return err
	}
	if err = p.insertInTransaction(wrappedTx, table, objects); err != nil {
		wrappedTx.Rollback()
		return err
	}

	return wrappedTx.DirectCommit()
}

func (p *Postgres) insertInTransaction(wrappedTx *Transaction, table *Table, objects []map[string]interface{}) error {
	start := time.Now()
	var placeholdersBuilder strings.Builder
	var header []string
	for name := range table.Columns {
		header = append(header, name)
	}
	maxValues := len(objects) * len(table.Columns)
	if maxValues > postgresValuesLimit {
		maxValues = postgresValuesLimit
	}
	valueArgs := make([]interface{}, 0, maxValues)
	placeholdersCounter := 1
	for _, row := range objects {
		// if number of values exceeds limit, we have to execute insert query on processed rows
		if len(valueArgs)+len(header) > postgresValuesLimit {
			err := p.executeInsert(wrappedTx, table, header, placeholdersBuilder, valueArgs)
			if err != nil {
				return err
			}
			logging.Infof("Inserted %d rows", len(valueArgs)/len(table.Columns))
			placeholdersBuilder.Reset()
			placeholdersCounter = 1
			valueArgs = make([]interface{}, 0, maxValues)
		}
		_, err := placeholdersBuilder.WriteString("(")
		if err != nil {
			return fmt.Errorf(placeholdersStringBuildErrTemplate, err)
		}
		for i, column := range header {
			value, _ := row[column]
			valueArgs = append(valueArgs, value)
			castClause := ""
			castType, ok := p.mappingTypeCasts[column]
			if ok {
				castClause = "::" + castType
			}
			_, err = placeholdersBuilder.WriteString("$" + strconv.Itoa(placeholdersCounter) + castClause)
			if err != nil {
				return fmt.Errorf(placeholdersStringBuildErrTemplate, err)
			}

			if i < len(header)-1 {
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
		err := p.executeInsert(wrappedTx, table, header, placeholdersBuilder, valueArgs)
		if err != nil {
			return err
		}
	}
	logging.Infof("Inserted [%d] rows in [%.2f] seconds", len(objects), time.Now().Sub(start).Seconds())
	return nil
}

func (p *Postgres) executeInsert(wrappedTx *Transaction, table *Table, header []string, placeholdersBuilder strings.Builder, valueArgs []interface{}) error {
	query := p.insertQuery(table.GetPKFields(), table.Name, strings.Join(header, ","), removeLastComma(placeholdersBuilder.String()))
	p.queryLogger.LogQuery(query)
	_, err := wrappedTx.tx.Exec(query, valueArgs...)
	return err
}

//get insert statement or merge on conflict statement
func (p *Postgres) insertQuery(pkFields []string, tableName string, header string, placeholders string) string {
	if len(pkFields) == 0 {
		return fmt.Sprintf(insertTemplate, p.config.Schema, tableName, header, placeholders)
	} else {
		return fmt.Sprintf(mergeTemplate, p.config.Schema, tableName, header, placeholders, buildConstraintName(p.config.Schema, tableName), updateSection(header))
	}
}

func buildConstraintName(schemaName string, tableName string) string {
	return schemaName + "_" + tableName + "_pk"
}

func updateSection(header string) string {
	split := strings.Split(header, ",")
	var result string
	for i, columnName := range split {
		result = strings.TrimSpace(result) + columnName + "=$" + strconv.Itoa(i+1) + ","
	}
	return removeLastComma(result)
}

//TablesList return slice of postgres table names
func (p *Postgres) TablesList() ([]string, error) {
	var tableNames []string
	rows, err := p.dataSource.QueryContext(p.ctx, tableNamesQuery, p.config.Schema)
	if err != nil {
		return tableNames, fmt.Errorf("Error querying tables names: %v", err)
	}

	defer rows.Close()
	for rows.Next() {
		var tableName string
		if err := rows.Scan(&tableName); err != nil {
			return tableNames, fmt.Errorf("Error scanning table name: %v", err)
		}
		tableNames = append(tableNames, tableName)
	}
	if err := rows.Err(); err != nil {
		return tableNames, fmt.Errorf("Last rows.Err: %v", err)
	}

	return tableNames, nil
}

//Close underlying sql.DB
func (p *Postgres) Close() error {
	return p.dataSource.Close()
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

//handle old (deprecated) mapping types //TODO remove someday
//put sql types as is
//if mapping type is inner => map with sql type
func reformatMappings(mappingTypeCasts map[string]string, dbTypes map[typing.DataType]string) map[string]string {
	formattedMappingTypeCasts := map[string]string{}
	for column, sqlType := range mappingTypeCasts {
		innerType, err := typing.TypeFromString(sqlType)
		if err != nil {
			formattedMappingTypeCasts[column] = sqlType
			continue
		}

		dbSqlType, _ := dbTypes[innerType]
		formattedMappingTypeCasts[column] = dbSqlType
	}

	return formattedMappingTypeCasts
}

func removeLastComma(str string) string {
	if last := len(str) - 1; last >= 0 && str[last] == ',' {
		str = str[:last]
	}

	return str
}
