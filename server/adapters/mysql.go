package adapters

import (
	"context"
	"database/sql"
	"fmt"
	_ "github.com/go-sql-driver/mysql"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/typing"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	mysqlCreateTableTemplate = `CREATE TABLE %s (%s)`
	mysqlInsertTemplate      = `INSERT INTO %s (%s) VALUES %s`
	mysqlValuesLimit         = 65535 // this is a limitation of parameters one can pass as query values. If more parameters are passed, error is returned
)

var (
	SchemaToMysql = map[typing.DataType]string{
		typing.STRING:    "MEDIUMTEXT", // A TEXT column with a maximum length of 16_777_215 characters
		typing.INT64:     "BIGINT",
		typing.FLOAT64:   "DECIMAL(38,18)",
		typing.TIMESTAMP: "TIMESTAMP",
		typing.BOOL:      "BOOLEAN",
		typing.UNKNOWN:   "MEDIUMTEXT", // A TEXT column with a maximum length of 16_777_215 characters
	}
)

//Mysql is adapter for creating, patching (schema or table), inserting data to mysql database
type Mysql struct {
	ctx         context.Context
	config      *DataSourceConfig
	dataSource  *sql.DB
	queryLogger *logging.QueryLogger

	sqlTypes typing.SQLTypes
}

//NewMysql returns configured Mysql adapter instance
func NewMysql(ctx context.Context, config *DataSourceConfig, queryLogger *logging.QueryLogger, sqlTypes typing.SQLTypes) (*Mysql, error) {
	connectionString := mysqlDriverConnectionString(config)
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

	return &Mysql{ctx: ctx, config: config, dataSource: dataSource, queryLogger: queryLogger, sqlTypes: reformatMappings(sqlTypes, SchemaToMysql)}, nil
}

func mysqlDriverConnectionString(config *DataSourceConfig) string {
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

//Type returns Mysql type
func (Mysql) Type() string {
	return "Mysql"
}

//OpenTx opens underline sql transaction and return wrapped instance
func (mysqlAdapter *Mysql) OpenTx() (*Transaction, error) {
	tx, err := mysqlAdapter.dataSource.BeginTx(mysqlAdapter.ctx, nil)
	if err != nil {
		return nil, err
	}

	return &Transaction{tx: tx, dbType: mysqlAdapter.Type()}, nil
}

//CreateTable creates database table with name,columns provided in Table representation
func (mysqlAdapter *Mysql) CreateTable(table *Table) error {
	wrappedTx, err := mysqlAdapter.OpenTx()
	if err != nil {
		return err
	}

	return mysqlAdapter.createTableInTransaction(wrappedTx, table)
}

//BulkInsert runs bulkStoreInTransaction
func (mysqlAdapter *Mysql) BulkInsert(table *Table, objects []map[string]interface{}) error {
	wrappedTx, err := mysqlAdapter.OpenTx()
	if err != nil {
		return err
	}

	if err = mysqlAdapter.bulkStoreInTransaction(wrappedTx, table, objects); err != nil {
		wrappedTx.Rollback()
		return err
	}

	return wrappedTx.DirectCommit()
}

func (mysqlAdapter *Mysql) bulkStoreInTransaction(wrappedTx *Transaction, table *Table, objects []map[string]interface{}) error {
	if len(table.PKFields) == 0 {
		return mysqlAdapter.bulkInsertInTransaction(wrappedTx, table, objects)
	}

	return mysqlAdapter.bulkMergeInTransaction(wrappedTx, table, objects)
}

//Must be used when table has no primary keys. Inserts data in batches to improve performance.
//Prefer to use bulkStoreInTransaction instead of calling this method directly
func (mysqlAdapter *Mysql) bulkInsertInTransaction(wrappedTx *Transaction, table *Table, objects []map[string]interface{}) error {
	var placeholdersBuilder strings.Builder
	var headerWithoutQuotes []string
	for name := range table.Columns {
		headerWithoutQuotes = append(headerWithoutQuotes, name)
	}
	maxValues := len(objects) * len(table.Columns)
	if maxValues > mysqlValuesLimit {
		maxValues = mysqlValuesLimit
	}
	valueArgs := make([]interface{}, 0, maxValues)
	placeholdersCounter := 1
	for _, row := range objects {
		// if number of values exceeds limit, we have to execute insert query on processed rows
		if len(valueArgs)+len(headerWithoutQuotes) > mysqlValuesLimit {
			err := mysqlAdapter.executeInsert(wrappedTx, table, headerWithoutQuotes, removeLastComma(placeholdersBuilder.String()), valueArgs)
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
		err := mysqlAdapter.executeInsert(wrappedTx, table, headerWithoutQuotes, removeLastComma(placeholdersBuilder.String()), valueArgs)
		if err != nil {
			return fmt.Errorf("Error executing last insert in bulk: %v", err)
		}
	}
	return nil
}

//TODO incompatible with mysql
//getCastClause returns ::SQL_TYPE clause or empty string
//$1::type, $2::type, $3, etc
func (mysqlAdapter *Mysql) getCastClause(name string) string {
	castType, ok := mysqlAdapter.sqlTypes[name]
	if ok {
		return "::" + castType.Type
	}

	return ""
}

//executeInsert executes insert with insertTemplate
func (mysqlAdapter *Mysql) executeInsert(wrappedTx *Transaction, table *Table, header []string, placeholders string, valueArgs []interface{}) error {
	statement := fmt.Sprintf(mysqlInsertTemplate, table.Name, strings.Join(header, ","), placeholders)

	mysqlAdapter.queryLogger.LogQueryWithValues(statement, valueArgs)

	if _, err := wrappedTx.tx.Exec(statement, valueArgs...); err != nil {
		return err
	}

	return nil
}

//Must be used only if table has primary key fields. Slower than bulkInsert as each query executed separately.
//Prefer to use bulkStoreInTransaction instead of calling this method directly
func (mysqlAdapter *Mysql) bulkMergeInTransaction(wrappedTx *Transaction, table *Table, objects []map[string]interface{}) error {
	var placeholders string
	var headerWithoutQuotes []string
	var headerWithQuotes []string
	i := 1
	for name := range table.Columns {
		headerWithoutQuotes = append(headerWithoutQuotes, name)
		headerWithQuotes = append(headerWithQuotes, fmt.Sprintf(`"%s"`, name))

		placeholders += "$" + strconv.Itoa(i) + mysqlAdapter.getCastClause(name) + ","

		i++
	}
	placeholders = "(" + removeLastComma(placeholders) + ")"

	statement := fmt.Sprintf(mergeTemplate,
		mysqlAdapter.config.Schema,
		table.Name,
		strings.Join(headerWithQuotes, ","),
		placeholders,
		buildConstraintName(mysqlAdapter.config.Schema, table.Name),
		mysqlAdapter.buildUpdateSection(headerWithoutQuotes),
	)
	mergeStmt, err := wrappedTx.tx.PrepareContext(mysqlAdapter.ctx, statement)
	if err != nil {
		return fmt.Errorf("Error preparing bulk merge statement [%s] table %s statement: %v", statement, table.Name, err)
	}

	for _, row := range objects {
		var values []interface{}
		for _, column := range headerWithoutQuotes {
			value, _ := row[column]
			values = append(values, value)
		}

		mysqlAdapter.queryLogger.LogQueryWithValues(statement, values)
		_, err = mergeStmt.ExecContext(mysqlAdapter.ctx, values...)
		if err != nil {
			return fmt.Errorf("Error bulk merging in %s table with statement: %s values: %v: %v", table.Name, statement, values, err)
		}
	}

	return nil
}

//buildUpdateSection returns value for merge update statement ("col1"=$1, "col2"=$2)
func (mysqlAdapter *Mysql) buildUpdateSection(header []string) string {
	var updateColumns []string
	for i, columnName := range header {
		updateColumns = append(updateColumns, fmt.Sprintf(`"%s"=$%d`, columnName, i+1))
	}
	return strings.Join(updateColumns, ",")
}

//columnDDL returns column DDL (quoted column name, mapped sql type and 'not null' if pk field)
func (mysqlAdapter *Mysql) columnDDL(name string, column Column, pkFields map[string]bool) string {
	var notNullClause string
	sqlType := column.SQLType

	if overriddenSQLType, ok := mysqlAdapter.sqlTypes[name]; ok {
		sqlType = overriddenSQLType.ColumnType
	}

	//not null
	if _, ok := pkFields[name]; ok {
		notNullClause = " NOT NULL " + mysqlAdapter.getDefaultValueStatement(sqlType)
	}

	return fmt.Sprintf(`%s %s%s`, name, sqlType, notNullClause)
}

//return default value statement for creating column
func (mysqlAdapter *Mysql) getDefaultValueStatement(sqlType string) string {
	//get default value based on type
	normalizedSqlType := strings.ToLower(sqlType)
	if strings.Contains(normalizedSqlType, "var") || strings.Contains(normalizedSqlType, "text") {
		return "DEFAULT ''"
	}

	return "DEFAULT 0"
}

//createPrimaryKeyInTransaction create primary key constraint
func (mysqlAdapter *Mysql) createPrimaryKeyInTransaction(wrappedTx *Transaction, table *Table) error {
	if len(table.PKFields) == 0 {
		return nil
	}

	var quotedColumnNames []string
	for _, column := range table.GetPKFields() {
		quotedColumnNames = append(quotedColumnNames, fmt.Sprintf(`"%s"`, column))
	}

	statement := fmt.Sprintf(alterPrimaryKeyTemplate,
		mysqlAdapter.config.Schema, table.Name, buildConstraintName(mysqlAdapter.config.Schema, table.Name), strings.Join(quotedColumnNames, ","))
	mysqlAdapter.queryLogger.LogDDL(statement)

	_, err := wrappedTx.tx.ExecContext(mysqlAdapter.ctx, statement)
	if err != nil {
		return fmt.Errorf("Error setting primary key [%s] %s table: %v", strings.Join(table.GetPKFields(), ","), table.Name, err)
	}

	return nil
}

//create table columns and pk key
//override input table sql type with configured cast type
//make fields from Table PkFields - 'not null'
func (mysqlAdapter *Mysql) createTableInTransaction(wrappedTx *Transaction, table *Table) error {
	var columnsDDL []string
	pkFields := table.GetPKFieldsMap()
	for columnName, column := range table.Columns {
		columnsDDL = append(columnsDDL, mysqlAdapter.columnDDL(columnName, column, pkFields))
	}

	//sorting columns asc
	sort.Strings(columnsDDL)
	query := fmt.Sprintf(mysqlCreateTableTemplate, table.Name, strings.Join(columnsDDL, ", "))
	mysqlAdapter.queryLogger.LogDDL(query)

	_, err := wrappedTx.tx.ExecContext(mysqlAdapter.ctx, query)

	if err != nil {
		wrappedTx.Rollback()
		return fmt.Errorf("Error creating [%s] table: %v", table.Name, err)
	}

	err = mysqlAdapter.createPrimaryKeyInTransaction(wrappedTx, table)
	if err != nil {
		wrappedTx.Rollback()
		return err
	}

	return wrappedTx.tx.Commit()
}
