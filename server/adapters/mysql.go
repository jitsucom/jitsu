package adapters

import (
	"context"
	"database/sql"
	"fmt"
	"github.com/go-sql-driver/mysql"
	_ "github.com/go-sql-driver/mysql"
	"github.com/jitsucom/jitsu/server/drivers/base"
	"github.com/jitsucom/jitsu/server/errorj"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/typing"
	"github.com/jitsucom/jitsu/server/uuid"
	"math"
	"sort"
	"strings"
	"time"
)

const (
	mySQLTableSchemaQuery = `SELECT
									column_name AS name,
									column_type AS column_type
								FROM information_schema.columns
								WHERE table_schema = ? AND table_name = ?`
	mySQLPrimaryKeyFieldsQuery = `SELECT
									column_name AS name
								FROM information_schema.columns
								WHERE table_schema = ? AND table_name = ? AND column_key = 'PRI'`
	mySQLCreateDBIfNotExistsTemplate = "CREATE DATABASE IF NOT EXISTS `%s`"
	mySQLCreateTableTemplate         = "CREATE TABLE `%s`.`%s` (%s)"
	mySQLInsertTemplate              = "INSERT INTO `%s`.`%s` (%s) VALUES %s"
	mySQLUpdateTemplate              = "UPDATE `%s`.`%s` SET %s WHERE %s=?"
	mySQLAlterPrimaryKeyTemplate     = "ALTER TABLE `%s`.`%s` ADD CONSTRAINT PRIMARY KEY (%s)"
	mySQLMergeTemplate               = "INSERT INTO `%s`.`%s` (%s) VALUES %s ON DUPLICATE KEY UPDATE %s"
	mySQLBulkMergeTemplate           = "INSERT INTO `%s`.`%s` (%s) SELECT * FROM (SELECT %s FROM `%s`.`%s`) AS tmp ON DUPLICATE KEY UPDATE %s"
	mySQLDeleteQueryTemplate         = "DELETE FROM `%s`.`%s` WHERE %s"
	mySQLAddColumnTemplate           = "ALTER TABLE `%s`.`%s` ADD COLUMN %s"
	mySQLRenameTableTemplate         = "RENAME TABLE `%s`.`%s` TO `%s`.`%s`"

	mySQLDropTableTemplate     = "DROP TABLE `%s`.`%s`"
	mySQLTruncateTableTemplate = "TRUNCATE TABLE `%s`.`%s`"
	MySQLValuesLimit           = 65535 // this is a limitation of parameters one can pass as query values. If more parameters are passed, error is returned
	batchRetryAttempts         = 3     //number of additional tries to proceed batch update or insert.
	// Batch operation takes a long time. And some mysql servers or middlewares prone to closing connections in the middle.
)

var (
	SchemaToMySQL = map[typing.DataType]string{
		typing.STRING:    "TEXT",
		typing.INT64:     "BIGINT",
		typing.FLOAT64:   "DOUBLE",
		typing.TIMESTAMP: "DATETIME", // TIMESTAMP type only supports values from 1970 to 2038, DATETIME doesn't have such constrains
		typing.BOOL:      "BOOLEAN",
		typing.UNKNOWN:   "TEXT",
	}

	//mySQLPrimaryKeyTypesMapping forces to use a special type in primary keys
	mySQLPrimaryKeyTypesMapping = map[string]string{
		"TEXT": "VARCHAR(255)",
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
	if _, ok := config.Parameters["tls"]; !ok {
		// similar to postgres default value of sslmode option
		config.Parameters["tls"] = "preferred"
	}
	connectionString := mySQLDriverConnectionString(config)
	dataSource, err := sql.Open("mysql", connectionString)
	if err != nil {
		return nil, err
	}

	if err := dataSource.Ping(); err != nil {
		dataSource.Close()
		return nil, err
	}

	//set default values
	dataSource.SetConnMaxLifetime(3 * time.Minute)
	dataSource.SetMaxIdleConns(10)

	return &MySQL{ctx: ctx, config: config, dataSource: dataSource, queryLogger: queryLogger, sqlTypes: reformatMappings(sqlTypes, SchemaToMySQL)}, nil
}

//Type returns MySQL type
func (MySQL) Type() string {
	return "MySQL"
}

//OpenTx opens underline sql transaction and return wrapped instance
func (m *MySQL) OpenTx() (*Transaction, error) {
	tx, err := m.dataSource.BeginTx(m.ctx, nil)
	if err != nil {
		return nil, errorj.BeginTransactionError.Wrap(err, "failed to begin transaction").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Schema: m.config.Db,
			})
	}

	return &Transaction{tx: tx, dbType: m.Type()}, nil
}

//CreateDB creates database instance if doesn't exist
func (m *MySQL) CreateDB(dbSchemaName string) error {
	query := fmt.Sprintf(mySQLCreateDBIfNotExistsTemplate, dbSchemaName)
	m.queryLogger.LogDDL(query)
	if _, err := m.dataSource.ExecContext(m.ctx, query); err != nil {
		return errorj.CreateSchemaError.Wrap(err, "failed to create db schema").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Schema:    dbSchemaName,
				Statement: query,
			})
	}

	return nil
}

//CreateTable creates database table with name,columns provided in Table representation
func (m *MySQL) CreateTable(table *Table) (err error) {
	wrappedTx, err := m.OpenTx()
	if err != nil {
		return err
	}

	defer func() {
		if err != nil {
			rbErr := wrappedTx.Rollback()
			if rbErr != nil {
				err = errorj.Group(err, rbErr)
			}
		} else {
			err = wrappedTx.Commit()
		}
	}()

	return m.createTableInTransaction(wrappedTx, table)
}

//PatchTableSchema adds new columns(from provided Table) to existing table
func (m *MySQL) PatchTableSchema(patchTable *Table) (err error) {
	wrappedTx, err := m.OpenTx()
	if err != nil {
		return err
	}

	defer func() {
		if err != nil {
			rbErr := wrappedTx.Rollback()
			if rbErr != nil {
				err = errorj.Group(err, rbErr)
			}
		} else {
			err = wrappedTx.Commit()
		}
	}()

	pkFields := patchTable.GetPKFieldsMap()
	//patch columns
	for _, columnName := range patchTable.SortedColumnNames() {
		column := patchTable.Columns[columnName]
		columnDDL := m.columnDDL(columnName, column, pkFields)
		query := fmt.Sprintf(mySQLAddColumnTemplate, m.config.Db, patchTable.Name, columnDDL)
		m.queryLogger.LogDDL(query)

		if _, err := wrappedTx.tx.ExecContext(m.ctx, query); err != nil {
			return errorj.PatchTableError.Wrap(err, "failed to patch table").
				WithProperty(errorj.DBInfo, &ErrorPayload{
					Schema:      m.config.Db,
					Table:       patchTable.Name,
					PrimaryKeys: patchTable.GetPKFields(),
					Statement:   query,
				})
		}
	}

	//patch primary keys.
	//Re-creation isn't supported. Instead of it just returns an error to do it manually
	if patchTable.DeletePkFields {
		return errorj.ManageMySQLPrimaryKeys.New("Jitsu can't manage MySQL primary key. Please add all columns from existent primary key to Jitsu MySQL destination configuration manually. Or you can delete primary key in the table then Jitsu will create it from primary_key_fields configuration. Read more about primary keys configuration https://jitsu.com/docs/configuration/primary-keys-configuration.").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Schema:      m.config.Db,
				Table:       patchTable.Name,
				PrimaryKeys: patchTable.GetPKFields(),
			})
	}

	//create new
	if len(patchTable.PKFields) > 0 {
		if err := m.createPrimaryKeyInTransaction(wrappedTx, patchTable); err != nil {
			return err
		}
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
	//don't set table.PrimaryKeyName because in MySQL primary key has always name: "PRIMARY" and Jitsu can't compare it
	return table, nil
}

//Insert provided object in mySQL with typecasts
//uses upsert (merge on conflict) if primary_keys are configured
func (m *MySQL) Insert(insertContext *InsertContext) error {
	if insertContext.eventContext != nil {
		return m.insertSingle(insertContext.eventContext)
	} else {
		return m.insertBatch(insertContext.table, insertContext.objects, insertContext.deleteConditions)
	}
}

//insertBatch inserts batch of provided objects in mysql with typecasts
//uses upsert if primary_keys are configured
func (m *MySQL) insertBatch(table *Table, objects []map[string]interface{}, deleteConditions *base.DeleteConditions) error {
	var e error
	// Batch operation takes a long time. And some mysql servers or middlewares prone to closing connections in the middle.
	for i := 0; i <= batchRetryAttempts; i++ {
		wrappedTx, err := m.OpenTx()
		if err != nil {
			return err
		}

		if err := m.insertBatchInTransaction(wrappedTx, table, objects, deleteConditions); err != nil {
			rbErr := wrappedTx.Rollback()
			if strings.Contains(err.Error(), mysql.ErrInvalidConn.Error()) || strings.Contains(err.Error(), "bad connection") {
				e = errorj.Group(err, rbErr)
				continue
			} else {
				return errorj.Group(err, rbErr)
			}
		}

		return wrappedTx.Commit()
	}

	return e
}

//insertSingle inserts single provided object in mysql with typecasts
//uses upsert if primary_keys are configured
func (m *MySQL) insertSingle(eventContext *EventContext) error {
	columnsWithoutQuotes, columnsWithQuotes, placeholders, values := m.buildInsertPayload(eventContext.ProcessedEvent)

	var statement string
	if len(eventContext.Table.PKFields) == 0 {
		statement = fmt.Sprintf(mySQLInsertTemplate, m.config.Db, eventContext.Table.Name, strings.Join(columnsWithQuotes, ", "), "("+strings.Join(placeholders, ", ")+")")
	} else {
		statement = fmt.Sprintf(mySQLMergeTemplate, m.config.Db, eventContext.Table.Name, strings.Join(columnsWithQuotes, ","), "("+strings.Join(placeholders, ", ")+")", m.buildUpdateSection(columnsWithoutQuotes))
		values = append(values, values...)
	}

	m.queryLogger.LogQueryWithValues(statement, values)

	if _, err := m.dataSource.ExecContext(m.ctx, statement, values...); err != nil {
		return errorj.ExecuteInsertError.Wrap(err, "failed to execute single insert").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Schema:      m.config.Db,
				Table:       eventContext.Table.Name,
				PrimaryKeys: eventContext.Table.GetPKFields(),
				Statement:   statement,
				Values:      values,
			})
	}

	return nil
}

//Update one record in MySQL
func (m *MySQL) Update(table *Table, object map[string]interface{}, whereKey string, whereValue interface{}) error {
	columns := make([]string, len(object), len(object))
	values := make([]interface{}, len(object)+1, len(object)+1)
	i := 0
	for name, value := range object {
		columns[i] = m.quote(name) + "= ?"
		values[i] = value
		i++
	}
	values[i] = whereValue

	statement := fmt.Sprintf(mySQLUpdateTemplate, m.config.Db, table.Name, strings.Join(columns, ", "), whereKey)
	m.queryLogger.LogQueryWithValues(statement, values)
	if _, err := m.dataSource.ExecContext(m.ctx, statement, values...); err != nil {
		return errorj.UpdateError.Wrap(err, "failed to update").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Schema:      m.config.Db,
				Table:       table.Name,
				PrimaryKeys: table.GetPKFields(),
				Statement:   statement,
				Values:      values,
			})
	}

	return nil
}

//DropTable drops table in transaction
func (m *MySQL) DropTable(table *Table) (err error) {
	wrappedTx, err := m.OpenTx()
	if err != nil {
		return err
	}

	defer func() {
		if err != nil {
			rbErr := wrappedTx.Rollback()
			if rbErr != nil {
				err = errorj.Group(err, rbErr)
			}
		} else {
			err = wrappedTx.Commit()
		}
	}()

	return m.dropTableInTransaction(wrappedTx, table)
}

func (m *MySQL) ReplaceTable(originalTable, replacementTable string) (err error) {
	wrappedTx, err := m.OpenTx()
	if err != nil {
		return err
	}

	defer func() {
		if err != nil {
			rbErr := wrappedTx.Rollback()
			if rbErr != nil {
				err = errorj.Group(err, rbErr)
			}
		} else {
			err = wrappedTx.Commit()
		}
	}()
	tmpTable := replacementTable + "_tmp"
	err1 := m.renameTableInTransaction(wrappedTx, originalTable, tmpTable)
	err = m.renameTableInTransaction(wrappedTx, replacementTable, originalTable)
	if err1 == nil {
		_ = m.dropTableInTransaction(wrappedTx, &Table{Name: tmpTable})
	}
	return
}

func (m *MySQL) deleteInTransaction(wrappedTx *Transaction, table *Table, deleteConditions *base.DeleteConditions) error {
	deleteCondition, values := m.toDeleteQuery(deleteConditions)
	query := fmt.Sprintf(mySQLDeleteQueryTemplate, m.config.Db, table.Name, deleteCondition)
	m.queryLogger.LogQueryWithValues(query, values)

	if _, err := wrappedTx.tx.ExecContext(m.ctx, query, values...); err != nil {
		return errorj.DeleteFromTableError.Wrap(err, "failed to delete data").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Database:    m.config.Db,
				Table:       table.Name,
				PrimaryKeys: table.GetPKFields(),
				Statement:   query,
				Values:      values,
			})
	}

	return nil
}

func (m *MySQL) toDeleteQuery(conditions *base.DeleteConditions) (string, []interface{}) {
	var queryConditions []string
	var values []interface{}
	for _, condition := range conditions.Conditions {
		quotedField := m.quote(condition.Field)
		queryConditions = append(queryConditions, quotedField+" "+condition.Clause+" ?")
		values = append(values, typing.ReformatValue(condition.Value))
	}
	return strings.Join(queryConditions, " "+conditions.JoinCondition+" "), values
}

//Truncate deletes all records in tableName table
func (m *MySQL) Truncate(tableName string) error {
	sqlParams := SqlParams{
		dataSource:  m.dataSource,
		queryLogger: m.queryLogger,
		ctx:         m.ctx,
	}
	statement := fmt.Sprintf(mySQLTruncateTableTemplate, m.config.Db, tableName)
	if err := sqlParams.commonTruncate(statement); err != nil {
		return errorj.TruncateError.Wrap(err, "failed to truncate table").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Database:  m.config.Db,
				Table:     tableName,
				Statement: statement,
			})
	}

	return nil
}

//Close underlying sql.DB
func (m *MySQL) Close() error {
	return m.dataSource.Close()
}

func (m *MySQL) getTable(tableName string) (*Table, error) {
	table := &Table{Schema: m.config.Db, Name: tableName, Columns: map[string]typing.SQLColumn{}, PKFields: map[string]bool{}}
	ctx, cancel := context.WithTimeout(m.ctx, 1*time.Minute)
	defer cancel()
	rows, err := m.dataSource.QueryContext(ctx, mySQLTableSchemaQuery, m.config.Db, tableName)
	if err != nil {
		return nil, errorj.GetTableError.Wrap(err, "failed to get table columns").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Database:    m.config.Db,
				Table:       table.Name,
				PrimaryKeys: table.GetPKFields(),
				Statement:   mySQLTableSchemaQuery,
				Values:      []interface{}{m.config.Db, tableName},
			})
	}

	defer rows.Close()
	for rows.Next() {
		var columnName, columnType string
		if err := rows.Scan(&columnName, &columnType); err != nil {
			return nil, errorj.GetTableError.Wrap(err, "failed to scan result").
				WithProperty(errorj.DBInfo, &ErrorPayload{
					Database:    m.config.Db,
					Table:       table.Name,
					PrimaryKeys: table.GetPKFields(),
					Statement:   mySQLTableSchemaQuery,
					Values:      []interface{}{m.config.Db, tableName},
				})
		}
		if columnType == "" {
			//skip dropped field
			continue
		}

		table.Columns[columnName] = typing.SQLColumn{Type: columnType}
	}

	if err := rows.Err(); err != nil {
		return nil, errorj.GetTableError.Wrap(err, "failed read last row").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Database:    m.config.Db,
				Table:       table.Name,
				PrimaryKeys: table.GetPKFields(),
				Statement:   mySQLTableSchemaQuery,
				Values:      []interface{}{m.config.Db, tableName},
			})
	}

	return table, nil
}

func (m *MySQL) getPrimaryKeys(tableName string) (map[string]bool, error) {
	primaryKeys := map[string]bool{}
	pkFieldsRows, err := m.dataSource.QueryContext(m.ctx, mySQLPrimaryKeyFieldsQuery, m.config.Db, tableName)
	if err != nil {
		return nil, errorj.GetPrimaryKeysError.Wrap(err, "failed to get primary key").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Database:  m.config.Db,
				Table:     tableName,
				Statement: mySQLPrimaryKeyFieldsQuery,
				Values:    []interface{}{m.config.Db, tableName},
			})
	}

	defer pkFieldsRows.Close()
	var pkFields []string
	for pkFieldsRows.Next() {
		var fieldName string
		if err := pkFieldsRows.Scan(&fieldName); err != nil {
			return nil, errorj.GetPrimaryKeysError.Wrap(err, "failed to scan result").
				WithProperty(errorj.DBInfo, &ErrorPayload{
					Database:  m.config.Db,
					Table:     tableName,
					Statement: mySQLPrimaryKeyFieldsQuery,
					Values:    []interface{}{m.config.Db, tableName},
				})
		}
		pkFields = append(pkFields, fieldName)
	}
	if err := pkFieldsRows.Err(); err != nil {
		return nil, errorj.GetPrimaryKeysError.Wrap(err, "failed read last row").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Database:  m.config.Db,
				Table:     tableName,
				Statement: mySQLPrimaryKeyFieldsQuery,
				Values:    []interface{}{m.config.Db, tableName},
			})
	}
	for _, field := range pkFields {
		primaryKeys[field] = true
	}

	return primaryKeys, nil
}

func mySQLDriverConnectionString(config *DataSourceConfig) string {
	// [user[:password]@][net[(addr)]]/dbname[?param1=value1&paramN=valueN]
	connectionString := fmt.Sprintf("%s:%s@tcp(%s:%d)/%s",
		config.Username, config.Password, config.Host, config.Port, config.Db)
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

//bulkStoreInTransaction checks PKFields and uses bulkInsert or bulkMerge
//in bulkMerge - deduplicate objects
//if there are any duplicates, do the job 2 times
func (m *MySQL) insertBatchInTransaction(wrappedTx *Transaction, table *Table, objects []map[string]interface{}, deleteConditions *base.DeleteConditions) error {
	if !deleteConditions.IsEmpty() {
		if err := m.deleteInTransaction(wrappedTx, table, deleteConditions); err != nil {
			return err
		}
	}

	if len(table.PKFields) == 0 {
		return m.bulkInsertInTransaction(wrappedTx, table, objects)
	}

	//deduplication for bulkMerge success (it fails if there is any duplicate)
	deduplicatedObjectsBuckets := deduplicateObjects(table, objects)

	for _, objectsBucket := range deduplicatedObjectsBuckets {
		if err := m.bulkMergeInTransaction(wrappedTx, table, objectsBucket); err != nil {
			return err
		}
	}

	return nil
}

//Must be used when table has no primary keys. Inserts data in batches to improve performance.
//Prefer to use bulkStoreInTransaction instead of calling this method directly
func (m *MySQL) bulkInsertInTransaction(wrappedTx *Transaction, table *Table, objects []map[string]interface{}) error {
	var placeholdersBuilder strings.Builder
	var headerWithoutQuotes []string
	for _, name := range table.SortedColumnNames() {
		headerWithoutQuotes = append(headerWithoutQuotes, name)
	}
	valuesAmount := len(objects) * len(table.Columns)
	maxValues := valuesAmount
	if maxValues > MySQLValuesLimit {
		maxValues = MySQLValuesLimit
	}
	valueArgs := make([]interface{}, 0, maxValues)
	placeholdersCounter := 1
	operation := 0
	operations := int(math.Max(1, float64(valuesAmount)/float64(MySQLValuesLimit)))
	for _, row := range objects {
		// if number of values exceeds limit, we have to execute insert query on processed rows
		if len(valueArgs)+len(headerWithoutQuotes) > MySQLValuesLimit {
			operation++
			err := m.executeInsertInTransaction(wrappedTx, table, headerWithoutQuotes, removeLastComma(placeholdersBuilder.String()), valueArgs)
			if err != nil {
				return errorj.Decorate(err, "middle insert %d of %d in batch", operation, operations)
			}

			placeholdersBuilder.Reset()
			placeholdersCounter = 1
			valueArgs = make([]interface{}, 0, maxValues)
		}
		_, _ = placeholdersBuilder.WriteString("(")

		for i, column := range headerWithoutQuotes {
			value := m.mapColumnValue(row[column])
			valueArgs = append(valueArgs, value)

			_, _ = placeholdersBuilder.WriteString("?")

			if i < len(headerWithoutQuotes)-1 {
				_, _ = placeholdersBuilder.WriteString(",")
			}
			placeholdersCounter++
		}
		_, _ = placeholdersBuilder.WriteString("),")
	}

	if len(valueArgs) > 0 {
		operation++
		if err := m.executeInsertInTransaction(wrappedTx, table, headerWithoutQuotes, removeLastComma(placeholdersBuilder.String()), valueArgs); err != nil {
			return errorj.Decorate(err, "last insert %d of %d in batch", operation, operations)
		}
	}
	return nil
}

//executeInsert executes insert with mySQLInsertTemplate
func (m *MySQL) executeInsertInTransaction(wrappedTx *Transaction, table *Table, headerWithoutQuotes []string, placeholders string, valueArgs []interface{}) error {
	var quotedHeader []string
	for _, columnName := range headerWithoutQuotes {
		quotedHeader = append(quotedHeader, m.quote(columnName))
	}

	statement := fmt.Sprintf(mySQLInsertTemplate, m.config.Db, table.Name, strings.Join(quotedHeader, ","), placeholders)

	m.queryLogger.LogQueryWithValues(statement, valueArgs)

	if _, err := wrappedTx.tx.Exec(statement, valueArgs...); err != nil {
		return errorj.ExecuteInsertInBatchError.Wrap(err, "failed to execute insert").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Database:        m.config.Db,
				Table:           table.Name,
				PrimaryKeys:     table.GetPKFields(),
				Statement:       statement,
				ValuesMapString: ObjectValuesToString(headerWithoutQuotes, valueArgs),
			})
	}

	return nil
}

//bulkMergeInTransaction creates tmp table without duplicates
//inserts all data into tmp table and using bulkMergeTemplate merges all data to main table
func (m *MySQL) bulkMergeInTransaction(wrappedTx *Transaction, table *Table, objects []map[string]interface{}) error {
	tmpTable := &Table{
		Name:           fmt.Sprintf("jitsu_tmp_%s", uuid.NewLettersNumbers()[:5]),
		Columns:        table.Columns,
		PKFields:       map[string]bool{},
		DeletePkFields: false,
	}

	err := m.createTableInTransaction(wrappedTx, tmpTable)
	if err != nil {
		return errorj.Decorate(err, "failed to create temporary table")
	}

	err = m.bulkInsertInTransaction(wrappedTx, tmpTable, objects)
	if err != nil {
		return errorj.Decorate(err, "failed to insert into temporary table")
	}

	//insert from select
	var setValues []string
	var headerWithQuotes []string
	var aliases []string
	i := 0
	for _, name := range table.SortedColumnNames() {
		quotedColumnName := m.quote(name)
		alias := fmt.Sprintf("c_%d", i)
		headerWithQuotes = append(headerWithQuotes, quotedColumnName)
		aliases = append(aliases, fmt.Sprintf("%s AS %s", quotedColumnName, alias))
		setValues = append(setValues, fmt.Sprintf("%s = %s", quotedColumnName, alias))
		i++
	}

	insertFromSelectStatement := fmt.Sprintf(mySQLBulkMergeTemplate,
		m.config.Db, table.Name,
		strings.Join(headerWithQuotes, ", "),
		strings.Join(aliases, ", "),
		m.config.Db, tmpTable.Name,
		strings.Join(setValues, ", "))
	m.queryLogger.LogQuery(insertFromSelectStatement)

	if _, err = wrappedTx.tx.ExecContext(m.ctx, insertFromSelectStatement); err != nil {
		return errorj.BulkMergeError.Wrap(err, "failed to bulk merge").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Database:    m.config.Db,
				Table:       table.Name,
				PrimaryKeys: table.GetPKFields(),
				Statement:   insertFromSelectStatement,
			})
	}

	//delete tmp table
	if err := m.dropTableInTransaction(wrappedTx, tmpTable); err != nil {
		return errorj.Decorate(err, "failed to drop temporary table")
	}

	return nil
}

func (m *MySQL) renameTableInTransaction(wrappedTx *Transaction, tableName, newTableName string) error {
	query := fmt.Sprintf(mySQLRenameTableTemplate, m.config.Db, tableName, m.config.Db, newTableName)
	m.queryLogger.LogDDL(query)

	if _, err := wrappedTx.tx.ExecContext(m.ctx, query); err != nil {
		return errorj.RenameError.Wrap(err, "failed to rename table").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Database:  m.config.Db,
				Table:     tableName,
				Statement: query,
			})
	}

	return nil
}

func (m *MySQL) dropTableInTransaction(wrappedTx *Transaction, table *Table) error {
	query := fmt.Sprintf(mySQLDropTableTemplate, m.config.Db, table.Name)
	m.queryLogger.LogDDL(query)

	if _, err := wrappedTx.tx.ExecContext(m.ctx, query); err != nil {
		return errorj.DropError.Wrap(err, "failed to drop table").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Database:    m.config.Db,
				Table:       table.Name,
				PrimaryKeys: table.GetPKFields(),
				Statement:   query,
			})
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
func (m *MySQL) columnDDL(name string, column typing.SQLColumn, pkFields map[string]bool) string {
	sqlType := column.DDLType()

	if overriddenSQLType, ok := m.sqlTypes[name]; ok {
		sqlType = overriddenSQLType.ColumnType
	}

	//map special types for primary keys (text -> varchar)
	//because old versions of MYSQL requires non null and default value on TEXT types
	if _, ok := pkFields[name]; ok {
		if typeForPKField, ok := mySQLPrimaryKeyTypesMapping[sqlType]; ok {
			sqlType = typeForPKField
		}
	}

	return fmt.Sprintf("%s %s", m.quote(name), sqlType)
}

//createPrimaryKeyInTransaction create primary key constraint
func (m *MySQL) createPrimaryKeyInTransaction(wrappedTx *Transaction, table *Table) error {
	if len(table.PKFields) == 0 {
		return nil
	}

	var quotedColumnNames []string
	for _, column := range table.GetPKFields() {
		quotedColumnNames = append(quotedColumnNames, m.quote(column))
	}

	statement := fmt.Sprintf(mySQLAlterPrimaryKeyTemplate,
		m.config.Db, table.Name, strings.Join(quotedColumnNames, ","))
	m.queryLogger.LogDDL(statement)

	if _, err := wrappedTx.tx.ExecContext(m.ctx, statement); err != nil {
		return errorj.CreatePrimaryKeysError.Wrap(err, "failed to set primary key").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Database:    m.config.Db,
				Table:       table.Name,
				PrimaryKeys: table.GetPKFields(),
				Statement:   statement,
			})
	}

	return nil
}

//create table columns and pk key
//override input table sql type with configured cast type
//make fields from Table PkFields - 'not null'
func (m *MySQL) createTableInTransaction(wrappedTx *Transaction, table *Table) error {
	var columnsDDL []string
	pkFields := table.GetPKFieldsMap()
	for _, columnName := range table.SortedColumnNames() {
		column := table.Columns[columnName]
		columnsDDL = append(columnsDDL, m.columnDDL(columnName, column, pkFields))
	}

	//sorting columns asc
	sort.Strings(columnsDDL)
	query := fmt.Sprintf(mySQLCreateTableTemplate, m.config.Db, table.Name, strings.Join(columnsDDL, ", "))
	m.queryLogger.LogDDL(query)

	if _, err := wrappedTx.tx.ExecContext(m.ctx, query); err != nil {
		return errorj.CreateTableError.Wrap(err, "failed to create table").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Database:    m.config.Db,
				Table:       table.Name,
				PrimaryKeys: table.GetPKFields(),
				Statement:   query,
			})
	}

	if err := m.createPrimaryKeyInTransaction(wrappedTx, table); err != nil {
		return err
	}

	return nil
}

func (m *MySQL) quote(str string) string {
	return fmt.Sprintf("`%s`", str)
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

func (m *MySQL) mapColumnValue(columnVal interface{}) interface{} {
	if datetime, ok := columnVal.(time.Time); ok {
		if datetime.IsZero() {
			// workaround for time.Time{} default value because of mysql driver internals
			return time.Date(1, 1, 1, 0, 0, 0, 1, time.UTC)
		}
	}
	return columnVal
}

func (m *MySQL) destinationId() interface{} {
	return m.ctx.Value(CtxDestinationId)
}
