package adapters

import (
	"context"
	"database/sql"
	"fmt"
	_ "github.com/go-sql-driver/mysql"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/typing"
	"sort"
	"strings"
	"time"
)

const (
	mySQLTableSchemaQuery = `SELECT
									column_name AS name,
									data_type AS column_type
								FROM information_schema.columns
								WHERE table_schema = ? AND table_name = ?`
	mySQLPrimaryKeyFieldsQuery = `SELECT
									column_name AS name
								FROM information_schema.columns
								WHERE table_schema = ? AND table_name = ? AND column_key = 'PRI'`
	mySQLCreateTableTemplate     = "CREATE TABLE `%s`.`%s` (%s)"
	mySQLInsertTemplate          = "INSERT INTO `%s`.`%s` (%s) VALUES %s"
	mySQLAlterPrimaryKeyTemplate = "ALTER TABLE `%s`.`%s` ADD CONSTRAINT %s PRIMARY KEY (%s)"
	mySQLMergeTemplate           = "INSERT INTO `%s`.`%s` (%s) VALUES %s ON DUPLICATE KEY UPDATE %s"
	mySQLDeleteQueryTemplate     = "DELETE FROM `%s`.`%s` WHERE %s"
	mySQLAddColumnTemplate       = "ALTER TABLE `%s`.`%s` ADD COLUMN %s"
	mySQLDropPrimaryKeyTemplate  = "ALTER TABLE `%s`.`%s` DROP PRIMARY KEY"
	mySQLPrimaryKeyMaxLength     = 32
	mySQLValuesLimit             = 65535 // this is a limitation of parameters one can pass as query values. If more parameters are passed, error is returned
)

var (
	SchemaToMySQL = map[typing.DataType]string{
		typing.STRING:    "TEXT",
		typing.INT64:     "BIGINT",
		typing.FLOAT64:   "DECIMAL(38,18)",
		typing.TIMESTAMP: "TIMESTAMP",
		typing.BOOL:      "BOOLEAN",
		typing.UNKNOWN:   "TEXT",
	}
)

//MySQL is adapter for creating, patching (schema or table), inserting data to mySQL database
type MySQL struct {
	ctx         context.Context
	config      *DataSourceConfig
	dataSource  *sql.DB
	queryLogger *logging.QueryLogger

	sqlTypes typing.SQLTypes
}

//NewMySQL returns configured MySQL adapter instance
func NewMySQL(ctx context.Context, config *DataSourceConfig, queryLogger *logging.QueryLogger, sqlTypes typing.SQLTypes) (*MySQL, error) {
	connectionString := mySQLDriverConnectionString(config)
	dataSource, err := sql.Open("mysql", connectionString)
	if err != nil {
		return nil, err
	}

	if err := dataSource.Ping(); err != nil {
		dataSource.Close()
		return nil, err
	}

	//set default value
	dataSource.SetConnMaxLifetime(10 * time.Minute)

	return &MySQL{ctx: ctx, config: config, dataSource: dataSource, queryLogger: queryLogger, sqlTypes: reformatMappings(sqlTypes, SchemaToMySQL)}, nil
}

//Insert provided object in mySQL with typecasts
//uses upsert (merge on conflict) if primary_keys are configured
func (m *MySQL) Insert(eventContext *EventContext) error {
	columnsWithoutQuotes, columnsWithQuotes, placeholders, values := m.buildInsertPayload(eventContext.ProcessedEvent)

	var statement string
	if len(eventContext.Table.PKFields) == 0 {
		statement = fmt.Sprintf(mySQLInsertTemplate, m.config.Schema, eventContext.Table.Name, strings.Join(columnsWithQuotes, ", "), "("+strings.Join(placeholders, ", ")+")")
	} else {
		statement = fmt.Sprintf(mySQLMergeTemplate, m.config.Schema, eventContext.Table.Name, strings.Join(columnsWithQuotes, ","), "("+strings.Join(placeholders, ", ")+")", m.buildUpdateSection(columnsWithoutQuotes))
		values = append(values, values...)
	}

	m.queryLogger.LogQueryWithValues(statement, values)

	_, err := m.dataSource.ExecContext(m.ctx, statement, values...)
	if err != nil {
		return fmt.Errorf("Error inserting in %s table with statement: %s values: %v: %v", eventContext.Table.Name, statement, values, err)
	}

	return nil
}

//GetTableSchema returns table (name,columns with name and types) representation wrapped in Table struct
func (m *MySQL) GetTableSchema(tableName string) (*Table, error) {
	table, err := m.getTable(tableName)
	if err != nil {
		return nil, err
	}

	//don't select primary keys of non-existent table
	if len(table.Columns) == 0 {
		return table, nil
	}

	pkFields, err := m.getPrimaryKeys(tableName)
	if err != nil {
		return nil, err
	}

	table.PKFields = pkFields
	return table, nil
}

//BulkUpdate deletes with deleteConditions and runs bulkStoreInTransaction
func (m *MySQL) BulkUpdate(table *Table, objects []map[string]interface{}, deleteConditions *DeleteConditions) error {
	wrappedTx, err := m.OpenTx()
	if err != nil {
		return err
	}

	if !deleteConditions.IsEmpty() {
		err := m.deleteInTransaction(wrappedTx, table, deleteConditions)
		if err != nil {
			wrappedTx.Rollback()
			return err
		}
	}

	if err := m.bulkStoreInTransaction(wrappedTx, table, objects); err != nil {
		wrappedTx.Rollback()
		return err
	}
	return wrappedTx.DirectCommit()
}

func (m *MySQL) deleteInTransaction(wrappedTx *Transaction, table *Table, deleteConditions *DeleteConditions) error {
	deleteCondition, values := m.toDeleteQuery(deleteConditions)
	query := fmt.Sprintf(mySQLDeleteQueryTemplate, m.config.Schema, table.Name, deleteCondition)
	m.queryLogger.LogQueryWithValues(query, values)

	if _, err := wrappedTx.tx.ExecContext(m.ctx, query, values...); err != nil {
		return fmt.Errorf("Error deleting using query: %s, error: %v", query, err)
	}

	return nil
}

func (m *MySQL) toDeleteQuery(conditions *DeleteConditions) (string, []interface{}) {
	var queryConditions []string
	var values []interface{}
	for _, condition := range conditions.Conditions {
		quotedField := m.quote(condition.Field)
		queryConditions = append(queryConditions, quotedField+" "+condition.Clause+" ?")
		values = append(values, condition.Value)
	}
	return strings.Join(queryConditions, conditions.JoinCondition), values
}

//PatchTableSchema adds new columns(from provided Table) to existing table
func (m *MySQL) PatchTableSchema(patchTable *Table) error {
	wrappedTx, err := m.OpenTx()
	if err != nil {
		return err
	}

	return m.patchTableSchemaInTransaction(wrappedTx, patchTable)
}

//Type returns MySQL type
func (MySQL) Type() string {
	return "MySQL"
}

//OpenTx opens underline sql transaction and return wrapped instance
func (m *MySQL) OpenTx() (*Transaction, error) {
	tx, err := m.dataSource.BeginTx(m.ctx, nil)
	if err != nil {
		return nil, err
	}

	return &Transaction{tx: tx, dbType: m.Type()}, nil
}

//CreateTable creates database table with name,columns provided in Table representation
func (m *MySQL) CreateTable(table *Table) error {
	wrappedTx, err := m.OpenTx()
	if err != nil {
		return err
	}

	return m.createTableInTransaction(wrappedTx, table)
}

//BulkInsert runs bulkStoreInTransaction
func (m *MySQL) BulkInsert(table *Table, objects []map[string]interface{}) error {
	wrappedTx, err := m.OpenTx()
	if err != nil {
		return err
	}

	if err = m.bulkStoreInTransaction(wrappedTx, table, objects); err != nil {
		wrappedTx.Rollback()
		return err
	}

	return wrappedTx.DirectCommit()
}

//Close underlying sql.DB
func (m *MySQL) Close() error {
	return m.dataSource.Close()
}

func (m *MySQL) getTable(tableName string) (*Table, error) {
	table := &Table{Name: tableName, Columns: map[string]Column{}, PKFields: map[string]bool{}}
	rows, err := m.dataSource.QueryContext(m.ctx, mySQLTableSchemaQuery, m.config.Schema, tableName)
	if err != nil {
		return nil, fmt.Errorf("Error querying table [%s] schema: %v", tableName, err)
	}

	defer rows.Close()
	for rows.Next() {
		var columnName, columnType string
		if err := rows.Scan(&columnName, &columnType); err != nil {
			return nil, fmt.Errorf("Error scanning result: %v", err)
		}
		if columnType == "" {
			//skip dropped field
			continue
		}

		table.Columns[columnName] = Column{SQLType: columnType}
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("Last rows.Err: %v", err)
	}

	return table, nil
}

func (m *MySQL) getPrimaryKeys(tableName string) (map[string]bool, error) {
	primaryKeys := map[string]bool{}
	pkFieldsRows, err := m.dataSource.QueryContext(m.ctx, mySQLPrimaryKeyFieldsQuery, m.config.Schema, tableName)
	if err != nil {
		return nil, fmt.Errorf("Error querying primary keys for [%s.%s] table: %v", m.config.Schema, tableName, err)
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

func mySQLDriverConnectionString(config *DataSourceConfig) string {
	// [user[:password]@][net[(addr)]]/dbname[?param1=value1&paramN=valueN]
	connectionString := fmt.Sprintf("%s:%s@tcp(%s:%s)/%s",
		config.Username, config.Password, config.Host, config.Port.String(), config.Db)
	if len(config.Parameters) > 0 {
		connectionString += "?"
		paramList := make([]string, 10)
		//concat provided connection parameters
		for k, v := range config.Parameters {
			paramList = append(paramList, k+"="+v)
		}
		connectionString += strings.Join(paramList, "&")
	}
	return connectionString
}

func (m *MySQL) bulkStoreInTransaction(wrappedTx *Transaction, table *Table, objects []map[string]interface{}) error {
	if len(table.PKFields) == 0 {
		return m.bulkInsertInTransaction(wrappedTx, table, objects)
	}

	return m.bulkMergeInTransaction(wrappedTx, table, objects)
}

//Must be used when table has no primary keys. Inserts data in batches to improve performance.
//Prefer to use bulkStoreInTransaction instead of calling this method directly
func (m *MySQL) bulkInsertInTransaction(wrappedTx *Transaction, table *Table, objects []map[string]interface{}) error {
	var placeholdersBuilder strings.Builder
	var headerWithoutQuotes []string
	for name := range table.Columns {
		headerWithoutQuotes = append(headerWithoutQuotes, name)
	}
	maxValues := len(objects) * len(table.Columns)
	if maxValues > mySQLValuesLimit {
		maxValues = mySQLValuesLimit
	}
	valueArgs := make([]interface{}, 0, maxValues)
	placeholdersCounter := 1
	for _, row := range objects {
		// if number of values exceeds limit, we have to execute insert query on processed rows
		if len(valueArgs)+len(headerWithoutQuotes) > mySQLValuesLimit {
			err := m.executeInsert(wrappedTx, table, headerWithoutQuotes, removeLastComma(placeholdersBuilder.String()), valueArgs)
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

			_, err = placeholdersBuilder.WriteString("?")
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
		err := m.executeInsert(wrappedTx, table, headerWithoutQuotes, removeLastComma(placeholdersBuilder.String()), valueArgs)
		if err != nil {
			return fmt.Errorf("Error executing last insert in bulk: %v", err)
		}
	}
	return nil
}

//executeInsert executes insert with mySQLInsertTemplate
func (m *MySQL) executeInsert(wrappedTx *Transaction, table *Table, headerWithoutQuotes []string, placeholders string, valueArgs []interface{}) error {
	var quotedHeader []string
	for _, columnName := range headerWithoutQuotes {
		quotedHeader = append(quotedHeader, m.quote(columnName))
	}

	statement := fmt.Sprintf(mySQLInsertTemplate, m.config.Schema, table.Name, strings.Join(quotedHeader, ","), placeholders)

	m.queryLogger.LogQueryWithValues(statement, valueArgs)

	if _, err := wrappedTx.tx.Exec(statement, valueArgs...); err != nil {
		return err
	}

	return nil
}

//Must be used only if table has primary key fields. Slower than bulkInsert as each query executed separately.
//Prefer to use bulkStoreInTransaction instead of calling this method directly
func (m *MySQL) bulkMergeInTransaction(wrappedTx *Transaction, table *Table, objects []map[string]interface{}) error {
	var placeholders string
	var headerWithoutQuotes []string
	var headerWithQuotes []string
	for name := range table.Columns {
		headerWithoutQuotes = append(headerWithoutQuotes, name)
		headerWithQuotes = append(headerWithQuotes, m.quote(name))
		placeholders += "?,"
	}
	placeholders = "(" + removeLastComma(placeholders) + ")"

	statement := fmt.Sprintf(mySQLMergeTemplate,
		m.config.Schema,
		table.Name,
		strings.Join(headerWithQuotes, ","),
		placeholders,
		m.buildUpdateSection(headerWithoutQuotes),
	)
	mergeStmt, err := wrappedTx.tx.PrepareContext(m.ctx, statement)
	if err != nil {
		return fmt.Errorf("Error preparing bulk merge statement [%s] table %s statement: %v", statement, table.Name, err)
	}

	for _, row := range objects {
		var values []interface{}
		for _, column := range headerWithoutQuotes {
			value, _ := row[column]
			values = append(values, value)
		}
		values = append(values, values...)

		m.queryLogger.LogQueryWithValues(statement, values)
		_, err = mergeStmt.ExecContext(m.ctx, values...)
		if err != nil {
			return fmt.Errorf("Error bulk merging in %s table with statement: %s values: %v: %v", table.Name, statement, values, err)
		}
	}

	return nil
}

//buildUpdateSection returns value for merge update statement ("col1"=$1, "col2"=$2)
func (m *MySQL) buildUpdateSection(header []string) string {
	var updateColumns []string
	for _, columnName := range header {
		updateColumns = append(updateColumns, fmt.Sprintf("%s=?", m.quote(columnName)))
	}
	return strings.Join(updateColumns, ",")
}

//columnDDL returns column DDL (quoted column name, mapped sql type and 'not null' if pk field)
func (m *MySQL) columnDDL(name string, column Column, pkFields map[string]bool) string {
	var notNullClause string
	sqlType := column.SQLType

	if overriddenSQLType, ok := m.sqlTypes[name]; ok {
		sqlType = overriddenSQLType.ColumnType
	}

	//not null
	if _, ok := pkFields[name]; ok {
		notNullClause = " NOT NULL " + m.getDefaultValueStatement(sqlType)
	}

	return fmt.Sprintf("%s %s%s", m.quote(name), sqlType, notNullClause)
}

//getDefaultValueStatement returns default value statement for creating column
func (m *MySQL) getDefaultValueStatement(sqlType string) string {
	//get default value based on type
	normalizedSqlType := strings.ToLower(sqlType)
	if strings.Contains(normalizedSqlType, "var") {
		return "DEFAULT ''"
	} else if strings.Contains(normalizedSqlType, "text") {
		return "DEFAULT ('')"
	}

	return "DEFAULT 0"
}

//createPrimaryKeyInTransaction create primary key constraint
func (m *MySQL) createPrimaryKeyInTransaction(wrappedTx *Transaction, table *Table) error {
	if len(table.PKFields) == 0 {
		return nil
	}

	var quotedColumnNames []string
	for _, column := range table.GetPKFields() {
		columnType := table.Columns[column].SQLType
		var quoted string
		if columnType == SchemaToMySQL[typing.STRING] || columnType == SchemaToMySQL[typing.UNKNOWN] {
			quoted = fmt.Sprintf("%s(%d)", m.quote(column), mySQLPrimaryKeyMaxLength)
		} else {
			quoted = m.quote(column)
		}
		quotedColumnNames = append(quotedColumnNames, quoted)
	}

	statement := fmt.Sprintf(mySQLAlterPrimaryKeyTemplate,
		m.config.Schema, table.Name, m.buildConstraintName(table.Name), strings.Join(quotedColumnNames, ","))
	m.queryLogger.LogDDL(statement)

	_, err := wrappedTx.tx.ExecContext(m.ctx, statement)
	if err != nil {
		return fmt.Errorf("Error setting primary key [%s] %s table: %v", strings.Join(table.GetPKFields(), ","), table.Name, err)
	}

	return nil
}

//create table columns and pk key
//override input table sql type with configured cast type
//make fields from Table PkFields - 'not null'
func (m *MySQL) createTableInTransaction(wrappedTx *Transaction, table *Table) error {
	var columnsDDL []string
	pkFields := table.GetPKFieldsMap()
	for columnName, column := range table.Columns {
		columnsDDL = append(columnsDDL, m.columnDDL(columnName, column, pkFields))
	}

	//sorting columns asc
	sort.Strings(columnsDDL)
	query := fmt.Sprintf(mySQLCreateTableTemplate, m.config.Schema, table.Name, strings.Join(columnsDDL, ", "))
	m.queryLogger.LogDDL(query)

	_, err := wrappedTx.tx.ExecContext(m.ctx, query)

	if err != nil {
		wrappedTx.Rollback()
		return fmt.Errorf("Error creating [%s] table: %v", table.Name, err)
	}

	err = m.createPrimaryKeyInTransaction(wrappedTx, table)
	if err != nil {
		wrappedTx.Rollback()
		return err
	}

	return wrappedTx.tx.Commit()
}

func (m *MySQL) buildConstraintName(tableName string) string {
	return m.quote(fmt.Sprintf("%s_%s_pk", m.config.Schema, tableName))
}

func (m *MySQL) quote(str string) string {
	return fmt.Sprintf("`%s`", str)
}

//alter table with columns (if not empty)
//recreate primary key (if not empty) or delete primary key if Table.DeletePkFields is true
func (m *MySQL) patchTableSchemaInTransaction(wrappedTx *Transaction, patchTable *Table) error {
	pkFields := patchTable.GetPKFieldsMap()
	//patch columns
	for columnName, column := range patchTable.Columns {
		columnDDL := m.columnDDL(columnName, column, pkFields)
		query := fmt.Sprintf(mySQLAddColumnTemplate, m.config.Schema, patchTable.Name, columnDDL)
		m.queryLogger.LogDDL(query)

		_, err := wrappedTx.tx.ExecContext(m.ctx, query)
		if err != nil {
			wrappedTx.Rollback()
			return fmt.Errorf("Error patching %s table with [%s] DDL: %v", patchTable.Name, columnDDL, err)
		}
	}

	//patch primary keys - delete old
	if patchTable.DeletePkFields {
		err := m.deletePrimaryKeyInTransaction(wrappedTx, patchTable)
		if err != nil {
			wrappedTx.Rollback()
			return err
		}
	}

	//patch primary keys - create new
	if len(patchTable.PKFields) > 0 {
		err := m.createPrimaryKeyInTransaction(wrappedTx, patchTable)
		if err != nil {
			wrappedTx.Rollback()
			return err
		}
	}

	return wrappedTx.DirectCommit()
}

//delete primary key
func (m *MySQL) deletePrimaryKeyInTransaction(wrappedTx *Transaction, table *Table) error {
	query := fmt.Sprintf(mySQLDropPrimaryKeyTemplate, m.config.Schema, table.Name)
	m.queryLogger.LogDDL(query)
	_, err := wrappedTx.tx.ExecContext(m.ctx, query)
	if err != nil {
		return fmt.Errorf("Failed to drop primary key constraint for table %s.%s: %v", m.config.Schema, table.Name, err)
	}

	return nil
}

//buildInsertPayload returns
// 1. column names slice
// 2. quoted column names slice
// 2. placeholders slice
// 3. values slice
func (m *MySQL) buildInsertPayload(valuesMap map[string]interface{}) ([]string, []string, []string, []interface{}) {
	header := make([]string, len(valuesMap), len(valuesMap))
	quotedHeader := make([]string, len(valuesMap), len(valuesMap))
	placeholders := make([]string, len(valuesMap), len(valuesMap))
	values := make([]interface{}, len(valuesMap), len(valuesMap))
	i := 0
	for name, value := range valuesMap {
		quotedHeader[i] = m.quote(name)
		header[i] = name

		placeholders[i] = "?"
		values[i] = value
		i++
	}

	return header, quotedHeader, placeholders, values
}
