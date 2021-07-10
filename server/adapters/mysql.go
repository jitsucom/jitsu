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
	mySQLCreateTableTemplate     = "CREATE TABLE `%s`.`%s` (%s)"
	mySQLInsertTemplate          = "INSERT INTO `%s`.`%s` (%s) VALUES %s"
	mySQLAlterPrimaryKeyTemplate = "ALTER TABLE `%s`.`%s` ADD CONSTRAINT %s PRIMARY KEY (%s)"
	mySQLMergeTemplate           = "INSERT INTO `%s`.`%s` (%s) VALUES %s ON DUPLICATE KEY UPDATE %s"
	mySQLValuesLimit             = 65535 // this is a limitation of parameters one can pass as query values. If more parameters are passed, error is returned
)

var (
	SchemaToMySQL = map[typing.DataType]string{
		//TODO revisit string type in MySQL, maybe string should be stored as varchar
		typing.STRING:    "MEDIUMTEXT", // A TEXT column with a maximum length of 16_777_215 characters
		typing.INT64:     "BIGINT",
		typing.FLOAT64:   "DECIMAL(38,18)",
		typing.TIMESTAMP: "TIMESTAMP",
		typing.BOOL:      "BOOLEAN",
		//TODO revisit string type in MySQL, maybe string should be stored as varchar
		typing.UNKNOWN: "MEDIUMTEXT", // A TEXT column with a maximum length of 16_777_215 characters
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

//TODO incompatible with mySQL
//getCastClause returns ::SQL_TYPE clause or empty string
//$1::type, $2::type, $3, etc
func (m *MySQL) getCastClause(name string) string {
	castType, ok := m.sqlTypes[name]
	if ok {
		return "::" + castType.Type
	}

	return ""
}

//executeInsert executes insert with postgresInsertTemplate
func (m *MySQL) executeInsert(wrappedTx *Transaction, table *Table, headerWithoutQuotes []string, placeholders string, valueArgs []interface{}) error {
	var quotedHeader []string
	for _, columnName := range headerWithoutQuotes {
		quotedHeader = append(quotedHeader, fmt.Sprintf("`%s`", columnName))
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
		headerWithQuotes = append(headerWithQuotes, m.quot(name))
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
		//TODO remove values duplication, add named placeholders instead of ?
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
		updateColumns = append(updateColumns, fmt.Sprintf("%s=?", m.quot(columnName)))
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

	return fmt.Sprintf("%s %s%s", m.quot(name), sqlType, notNullClause)
}

//getDefaultValueStatement returns default value statement for creating column
func (m *MySQL) getDefaultValueStatement(sqlType string) string {
	//get default value based on type
	normalizedSqlType := strings.ToLower(sqlType)
	if strings.Contains(normalizedSqlType, "var") || strings.Contains(normalizedSqlType, "text") {
		return "DEFAULT ''"
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
		quotedColumnNames = append(quotedColumnNames, m.quot(column))
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
	return m.quot(fmt.Sprintf("%s_%s_pk", m.config.Schema, tableName))
}

func (m *MySQL) quot(str string) string {
	return fmt.Sprintf("`%s`", str)
}
