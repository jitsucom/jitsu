package sql

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"os"
	"strings"
	"text/template"
	"time"

	"github.com/go-sql-driver/mysql"
	_ "github.com/go-sql-driver/mysql"
	bulker "github.com/jitsucom/bulker/bulkerlib"
	types2 "github.com/jitsucom/bulker/bulkerlib/types"
	"github.com/jitsucom/bulker/jitsubase/errorj"
	"github.com/jitsucom/bulker/jitsubase/jsoniter"
	"github.com/jitsucom/bulker/jitsubase/jsonorder"
	"github.com/jitsucom/bulker/jitsubase/logging"
	"github.com/jitsucom/bulker/jitsubase/utils"
)

func init() {
	bulker.RegisterBulker(MySQLBulkerTypeId, NewMySQL)
}

const (
	MySQLBulkerTypeId = "mysql"

	mySQLTableSchemaQuery = `SELECT
									column_name AS name,
									column_type AS column_type
								FROM information_schema.columns
								WHERE table_schema = ? AND table_name = ? order by ORDINAL_POSITION`
	mySQLPrimaryKeyFieldsQuery = `SELECT
									column_name AS name
								FROM information_schema.KEY_COLUMN_USAGE
								WHERE table_schema = ? AND table_name = ? AND CONSTRAINT_NAME = 'PRIMARY' order by ORDINAL_POSITION`
	mySQLDropPrimaryKeyTemplate      = `ALTER TABLE %s%s DROP PRIMARY KEY`
	mySQLAlterPrimaryKeyTemplate     = `ALTER TABLE %s%s ADD PRIMARY KEY (%s)`
	mySQLCreateDBIfNotExistsTemplate = "CREATE DATABASE IF NOT EXISTS %s"
	mySQLAllowLocalFile              = "SET GLOBAL local_infile = 1"
	mySQLIndexTemplate               = `CREATE INDEX %s ON %s%s (%s);`
	mySQLLoadTemplate                = `LOAD DATA LOCAL INFILE '%s' INTO TABLE %s%s FIELDS TERMINATED BY ',' ENCLOSED BY '"' LINES TERMINATED BY '\n' IGNORE 1 LINES (%s)`
	mySQLMergeQuery                  = `INSERT INTO {{.Namespace}}{{.TableName}}({{.Columns}}) VALUES ({{.Placeholders}}) ON DUPLICATE KEY UPDATE {{.UpdateSet}}`
	mySQLBulkMergeQuery              = "INSERT INTO {{.Namespace}}{{.TableTo}}({{.Columns}}) SELECT * FROM (SELECT {{.Columns}} FROM {{.NamespaceFrom}}{{.TableFrom}}) AS S ON DUPLICATE KEY UPDATE {{.UpdateSet}}"
)

var (
	mySQLMergeQueryTemplate, _     = template.New("mysqlMergeQuery").Parse(mySQLMergeQuery)
	mySQLBulkMergeQueryTemplate, _ = template.New("mysqlBulkMergeQuery").Parse(mySQLBulkMergeQuery)

	mysqlTypes = map[types2.DataType][]string{
		types2.STRING:    {"text", "varchar(255)", "varchar"},
		types2.INT64:     {"bigint"},
		types2.FLOAT64:   {"double"},
		types2.TIMESTAMP: {"timestamp(6)", "timestamp"},
		types2.BOOL:      {"boolean", "tinyint(1)"},
		types2.JSON:      {"JSON", "json"},
		types2.UNKNOWN:   {"text"},
	}

	//mySQLPrimaryKeyTypesMapping forces to use a special type in primary keys
	mySQLPrimaryKeyTypesMapping = map[string]string{
		"text": "varchar(255)",
	}
)

// MySQL is adapter for creating, patching (schema or table), inserting data to mySQL database
type MySQL struct {
	*SQLAdapterBase[DataSourceConfig]
	infileEnabled bool
}

func (m *MySQL) Type() string {
	return MySQLBulkerTypeId
}

// NewMySQL returns configured MySQL adapter instance
func NewMySQL(bulkerConfig bulker.Config) (bulker.Bulker, error) {
	config := &DataSourceConfig{}
	if err := utils.ParseObject(bulkerConfig.DestinationConfig, config); err != nil {
		return nil, fmt.Errorf("failed to parse destination config: %v", err)
	}

	if config.Parameters == nil {
		config.Parameters = map[string]string{}
	}
	utils.MapPutIfAbsent(config.Parameters, "tls", "preferred")

	utils.MapPutIfAbsent(config.Parameters, "timeout", "60s")
	utils.MapPutIfAbsent(config.Parameters, "writeTimeout", "60s")
	utils.MapPutIfAbsent(config.Parameters, "readTimeout", "60s")
	utils.MapPutIfAbsent(config.Parameters, "charset", "utf8mb4,utf8")

	dbConnectFunction := func(ctx context.Context, cfg *DataSourceConfig) (*sql.DB, error) {
		connectionString := mySQLDriverConnectionString(config)
		dataSource, err := sql.Open("mysql", connectionString)
		if err != nil {
			return nil, err
		}

		if err := dataSource.PingContext(ctx); err != nil {
			dataSource.Close()
			return nil, err
		}
		//rows, err := dataSource.Query("SHOW GLOBAL VARIABLES LIKE 'local_infile'")
		//infileEnabled := false
		//if err == nil && rows.Next() {
		//	varRow, _ := rowToMap(rows)
		//	infileEnabled = varRow["value"] == "ON"
		//}
		//if !infileEnabled {
		//	_, err = dataSource.Exec(mySQLAllowLocalFile)
		//	if err != nil {
		//		logging.Warnf("[%s] Loading tables from local batch file is disabled. Bulk loading will fallback to insert statements. To enable loading from files add to [mysql] and [mysqld] sections of my.cnf file the following line: local-infile=1", bulkerConfig.Id)
		//	} else {
		//		infileEnabled = true
		//	}
		//}

		//set default values
		dataSource.SetConnMaxLifetime(3 * time.Minute)
		dataSource.SetMaxIdleConns(10)
		return dataSource, nil
	}
	typecastFunc := func(placeholder string, column types2.SQLColumn) string {
		return placeholder
	}
	var queryLogger *logging.QueryLogger
	if bulkerConfig.LogLevel == bulker.Verbose {
		queryLogger = logging.NewQueryLogger(bulkerConfig.Id, os.Stderr, os.Stderr)
	}
	// disable infile support for convenience
	infileEnabled := false
	sqlAdapterBase, err := newSQLAdapterBase(bulkerConfig.Id, MySQLBulkerTypeId, config, config.Db, dbConnectFunction, mysqlTypes, queryLogger, typecastFunc, QuestionMarkParameterPlaceholder, mySQLColumnDDL, mySQLMapColumnValue, checkErr, true)
	m := &MySQL{
		SQLAdapterBase: sqlAdapterBase,
		infileEnabled:  infileEnabled,
	}
	if infileEnabled {
		m.batchFileFormat = types2.FileFormatCSV
	} else {
		m.batchFileFormat = types2.FileFormatNDJSON
	}
	m.tableHelper = NewTableHelper(MySQLBulkerTypeId, 63, '`')
	m.createPKFunc = m.createPrimaryKey
	m.dropPKFunc = m.deletePrimaryKey
	return m, err
}

func (m *MySQL) CreateStream(id, tableName string, mode bulker.BulkMode, streamOptions ...bulker.StreamOption) (bulker.BulkerStream, error) {
	streamOptions = append(streamOptions, withLocalBatchFile(fmt.Sprintf("bulker_%s", utils.SanitizeString(id))))
	if err := m.validateOptions(streamOptions); err != nil {
		return nil, err
	}
	switch mode {
	case bulker.Stream:
		return newAutoCommitStream(id, m, tableName, streamOptions...)
	case bulker.Batch:
		return newTransactionalStream(id, m, tableName, streamOptions...)
	case bulker.ReplaceTable:
		return newReplaceTableStream(id, m, tableName, streamOptions...)
	case bulker.ReplacePartition:
		return newReplacePartitionStream(id, m, tableName, streamOptions...)
	}
	return nil, fmt.Errorf("unsupported bulk mode: %s", mode)
}

func (m *MySQL) validateOptions(streamOptions []bulker.StreamOption) error {
	options := &bulker.StreamOptions{}
	for _, option := range streamOptions {
		options.Add(option)
	}
	return nil
}

func (m *MySQL) createDatabaseIfNotExists(ctx context.Context, database string) error {
	if database == "" {
		return nil
	}
	n := m.NamespaceName(database)
	if n == "" {
		return nil
	}
	query := fmt.Sprintf(mySQLCreateDBIfNotExistsTemplate, n)
	if _, err := m.txOrDb(ctx).ExecContext(ctx, query); err != nil {
		return errorj.CreateSchemaError.Wrap(err, "failed to create database").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Database:  m.config.Db,
				Statement: query,
			})
	}
	return nil
}

// InitDatabase creates database instance if doesn't exist
func (m *MySQL) InitDatabase(ctx context.Context) error {
	_ = m.createDatabaseIfNotExists(ctx, m.config.Db)
	return nil
}

// OpenTx opens underline sql transaction and return wrapped instance
func (m *MySQL) OpenTx(ctx context.Context) (*TxSQLAdapter, error) {
	return m.openTx(ctx, m)
}

func (m *MySQL) Insert(ctx context.Context, table *Table, merge bool, objects ...types2.Object) error {
	//fmt.Printf("Inserting %d objects into %s merge %t\n", len(objects), table.Name, merge)
	if !merge {
		return m.insert(ctx, table, objects)
	} else {
		return m.insertOrMerge(ctx, table, objects, mySQLMergeQueryTemplate)
	}
}

func (m *MySQL) CopyTables(ctx context.Context, targetTable *Table, sourceTable *Table, mergeWindow int, discriminatorColumn string) (bulker.WarehouseState, error) {
	if mergeWindow <= 0 {
		return m.copy(ctx, targetTable, sourceTable)
	} else {
		return m.copyOrMerge(ctx, targetTable, sourceTable, mySQLBulkMergeQueryTemplate, "T", "S", mergeWindow, discriminatorColumn)
	}
}

func (m *MySQL) LoadTable(ctx context.Context, targetTable *Table, loadSource *LoadSource) (state bulker.WarehouseState, err error) {
	quotedTableName := m.quotedTableName(targetTable.Name)
	quotedNamespace := m.namespacePrefix(targetTable.Namespace)

	if loadSource.Type != LocalFile {
		return state, fmt.Errorf("LoadTable: only local file is supported")
	}
	if loadSource.Format != m.batchFileFormat {
		mode := "LOCAL INFILE"
		if !m.infileEnabled {
			mode = "prepared statement"
		}
		return state, fmt.Errorf("LoadTable: only %s format is supported in %s mode", m.batchFileFormat, mode)
	}
	count := targetTable.ColumnsCount()
	if m.infileEnabled {
		mysql.RegisterLocalFile(loadSource.Path)
		defer mysql.DeregisterLocalFile(loadSource.Path)

		header := targetTable.MappedColumnNames(m.quotedColumnName)
		loadStatement := fmt.Sprintf(mySQLLoadTemplate, loadSource.Path, quotedNamespace, quotedTableName, strings.Join(header, ", "))
		if _, err := m.txOrDb(ctx).ExecContext(ctx, loadStatement); err != nil {
			return state, errorj.LoadError.Wrap(err, "failed to load data from local file system").
				WithProperty(errorj.DBInfo, &types2.ErrorPayload{
					Database:  m.config.Db,
					Table:     quotedTableName,
					Statement: loadStatement,
				})
		}
		return state, nil
	} else {
		columnNames := make([]string, count)
		placeholders := make([]string, count)
		targetTable.Columns.ForEachIndexed(func(i int, name string, col types2.SQLColumn) {
			columnNames[i] = m.quotedColumnName(name)
			placeholders[i] = m.typecastFunc(m.parameterPlaceholder(i+1, name), col)
		})
		insertPayload := QueryPayload{
			Namespace:      quotedNamespace,
			TableName:      quotedTableName,
			Columns:        strings.Join(columnNames, ", "),
			Placeholders:   strings.Join(placeholders, ", "),
			PrimaryKeyName: targetTable.PrimaryKeyName,
		}
		buf := strings.Builder{}
		err := insertQueryTemplate.Execute(&buf, insertPayload)
		if err != nil {
			return state, errorj.ExecuteInsertError.Wrap(err, "failed to build query from template")
		}
		statement := buf.String()
		defer func() {
			if err != nil {
				err = errorj.LoadError.Wrap(err, "failed to load table").
					WithProperty(errorj.DBInfo, &types2.ErrorPayload{
						Schema:    m.config.Schema,
						Table:     quotedTableName,
						Statement: statement,
					})
			}
		}()

		stmt, err := m.txOrDb(ctx).PrepareContext(ctx, statement)
		if err != nil {
			return state, err
		}
		defer func() {
			_ = stmt.Close()
		}()
		//f, err := os.ReadFile(loadSource.Path)
		//m.Infof("FILE: %s", f)

		file, err := os.Open(loadSource.Path)
		if err != nil {
			return state, err
		}
		defer func() {
			_ = file.Close()
		}()
		decoder := jsoniter.NewDecoder(file)
		decoder.UseNumber()
		args := make([]any, count)
		for {
			var object map[string]any
			err = decoder.Decode(&object)
			if err != nil {
				if err == io.EOF {
					break
				}
				return state, err
			}
			targetTable.Columns.ForEachIndexed(func(i int, name string, col types2.SQLColumn) {
				val, ok := object[name]
				if ok {
					val, _ = types2.ReformatValue(val)
				}
				args[i] = m.valueMappingFunction(val, ok, col)
			})
			if _, err := stmt.ExecContext(ctx, args...); err != nil {
				return state, checkErr(err)
			}
		}
		return state, nil
	}
}

// GetTableSchema returns table (name,columns with name and types) representation wrapped in Table struct
func (m *MySQL) GetTableSchema(ctx context.Context, namespace string, tableName string) (*Table, error) {
	table, err := m.getTable(ctx, namespace, tableName)
	if err != nil {
		return nil, err
	}

	//don't select primary keys of non-existent table
	if table.ColumnsCount() == 0 {
		return table, nil
	}

	pkFields, err := m.getPrimaryKeys(ctx, namespace, tableName)
	if err != nil {
		return nil, err
	}

	table.PKFields = pkFields
	if pkFields.Size() > 0 {
		//in MySQL primary key has always name: "PRIMARY"
		table.PrimaryKeyName = "PRIMARY"
	}
	return table, nil
}

func (m *MySQL) getTable(ctx context.Context, namespace, tableName string) (*Table, error) {
	tableName = m.TableName(tableName)
	namespace = m.NamespaceName(namespace)
	table := &Table{Name: tableName, Namespace: namespace, Columns: NewColumns(0), PKFields: jsonorder.NewOrderedSet[string]()}
	ctx, cancel := context.WithTimeout(ctx, 1*time.Minute)
	defer cancel()
	rows, err := m.dataSource.QueryContext(ctx, mySQLTableSchemaQuery, namespace, tableName)
	if err != nil {
		return nil, errorj.GetTableError.Wrap(err, "failed to get table columns").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Database:    namespace,
				Table:       tableName,
				PrimaryKeys: table.GetPKFields(),
				Statement:   mySQLTableSchemaQuery,
				Values:      []any{m.config.Db, tableName},
			})
	}

	defer rows.Close()
	for rows.Next() {
		var columnName, columnType string
		if err := rows.Scan(&columnName, &columnType); err != nil {
			return nil, errorj.GetTableError.Wrap(err, "failed to scan result").
				WithProperty(errorj.DBInfo, &types2.ErrorPayload{
					Database:    namespace,
					Table:       tableName,
					PrimaryKeys: table.GetPKFields(),
					Statement:   mySQLTableSchemaQuery,
					Values:      []any{m.config.Db, tableName},
				})
		}
		if columnType == "" {
			//skip dropped field
			continue
		}
		dt, _ := m.GetDataType(columnType)
		table.Columns.Set(columnName, types2.SQLColumn{Type: columnType, DataType: dt})
	}

	if err := rows.Err(); err != nil {
		return nil, errorj.GetTableError.Wrap(err, "failed read last row").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Database:    namespace,
				Table:       tableName,
				PrimaryKeys: table.GetPKFields(),
				Statement:   mySQLTableSchemaQuery,
				Values:      []any{m.config.Db, tableName},
			})
	}

	return table, nil
}

func (m *MySQL) getPrimaryKeys(ctx context.Context, namespace, tableName string) (jsonorder.OrderedSet[string], error) {
	tableName = m.TableName(tableName)
	namespace = m.NamespaceName(namespace)
	pkFieldsRows, err := m.dataSource.QueryContext(ctx, mySQLPrimaryKeyFieldsQuery, namespace, tableName)
	if err != nil {
		return jsonorder.OrderedSet[string]{}, errorj.GetPrimaryKeysError.Wrap(err, "failed to get primary key").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Database:  namespace,
				Table:     tableName,
				Statement: mySQLPrimaryKeyFieldsQuery,
				Values:    []any{m.config.Db, tableName},
			})
	}

	defer pkFieldsRows.Close()

	pkFields := jsonorder.NewOrderedSet[string]()
	for pkFieldsRows.Next() {
		var fieldName string
		if err := pkFieldsRows.Scan(&fieldName); err != nil {
			return jsonorder.OrderedSet[string]{}, errorj.GetPrimaryKeysError.Wrap(err, "failed to scan result").
				WithProperty(errorj.DBInfo, &types2.ErrorPayload{
					Database:  namespace,
					Table:     tableName,
					Statement: mySQLPrimaryKeyFieldsQuery,
					Values:    []any{m.config.Db, tableName},
				})
		}
		pkFields.Put(fieldName)
	}
	if err := pkFieldsRows.Err(); err != nil {
		return jsonorder.OrderedSet[string]{}, errorj.GetPrimaryKeysError.Wrap(err, "failed read last row").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Database:  namespace,
				Table:     tableName,
				Statement: mySQLPrimaryKeyFieldsQuery,
				Values:    []any{m.config.Db, tableName},
			})
	}

	return pkFields, nil
}

func (m *MySQL) ReplaceTable(ctx context.Context, targetTableName string, replacementTable *Table, dropOldTable bool) (err error) {
	tmpTable := "deprecated_" + targetTableName + time.Now().Format("_20060102_150405")
	err1 := m.renameTable(ctx, true, replacementTable.Namespace, targetTableName, tmpTable)
	err = m.renameTable(ctx, false, replacementTable.Namespace, replacementTable.Name, targetTableName)
	if dropOldTable && err1 == nil && err == nil {
		return m.DropTable(ctx, replacementTable.Namespace, tmpTable, true)
	}
	return
}

func (m *MySQL) renameTable(ctx context.Context, ifExists bool, namespace, tableName, newTableName string) error {
	if ifExists {
		db := m.NamespaceName(namespace)
		tableName = m.TableName(tableName)
		row := m.txOrDb(ctx).QueryRowContext(ctx, fmt.Sprintf(`SELECT EXISTS (SELECT * FROM information_schema.tables WHERE table_schema = '%s' AND table_name = '%s')`, db, tableName))
		exists := false
		err := row.Scan(&exists)
		if err != nil {
			return err
		}
		if !exists {
			return nil
		}
	}
	return m.SQLAdapterBase.renameTable(ctx, false, namespace, tableName, newTableName)
}

func mySQLDriverConnectionString(config *DataSourceConfig) string {
	// [user[:password]@][net[(addr)]]/dbname[?param1=value1&paramN=valueN]
	connectionString := fmt.Sprintf("%s:%s@tcp(%s:%d)/%s",
		config.Username, config.Password, config.Host, config.Port, config.Db)
	if len(config.Parameters) > 0 {
		connectionString += "?"
		paramList := make([]string, 0, len(config.Parameters))
		//concat provided connection parameters
		for k, v := range config.Parameters {
			paramList = append(paramList, k+"="+v)
		}
		connectionString += strings.Join(paramList, "&")
	}
	return connectionString
}

// mySQLColumnDDL returns column DDL (quoted column name, mapped sql type and 'not null' if pk field)
func mySQLColumnDDL(quotedName, name string, table *Table, column types2.SQLColumn) string {
	sqlType := column.GetDDLType()

	//map special types for primary keys (text -> varchar)
	//because old versions of MYSQL requires non null and default value on TEXT types
	if table.PKFields.Contains(name) {
		if typeForPKField, ok := mySQLPrimaryKeyTypesMapping[sqlType]; ok {
			sqlType = typeForPKField
		}
	}

	return fmt.Sprintf("%s %s", quotedName, sqlType)
}

func mySQLMapColumnValue(value any, valuePresent bool, column types2.SQLColumn) any {
	if !valuePresent {
		return value
	}
	if datetime, ok := value.(time.Time); ok {
		if datetime.IsZero() {
			// workaround for time.Time{} default value because of mysql driver internals
			return time.Date(1, 1, 1, 0, 0, 0, 1, time.UTC)
		}
	}
	return value
}

func (m *MySQL) CreateTable(ctx context.Context, schemaToCreate *Table) (*Table, error) {
	err := m.createDatabaseIfNotExists(ctx, schemaToCreate.Namespace)
	if err != nil {
		return nil, err
	}
	err = m.SQLAdapterBase.CreateTable(ctx, schemaToCreate)
	if err != nil {
		return nil, err
	}
	if !schemaToCreate.Temporary && schemaToCreate.TimestampColumn != "" {
		err = m.createIndex(ctx, schemaToCreate)
		if err != nil {
			m.DropTable(ctx, schemaToCreate.Namespace, schemaToCreate.Name, true)
			return nil, fmt.Errorf("failed to create sort key: %v", err)
		}
	}
	return schemaToCreate, nil
}

func (m *MySQL) createPrimaryKey(ctx context.Context, table *Table) error {
	if table.PKFields.Empty() {
		return nil
	}

	quotedTableName := m.quotedTableName(table.Name)
	quotedSchema := m.namespacePrefix(table.Namespace)

	columnNames := make([]string, table.PKFields.Size())
	for i, column := range table.GetPKFields() {
		columnNames[i] = m.quotedColumnName(column)
	}

	statement := fmt.Sprintf(mySQLAlterPrimaryKeyTemplate, quotedSchema,
		quotedTableName, strings.Join(columnNames, ","))

	if _, err := m.txOrDb(ctx).ExecContext(ctx, statement); err != nil {
		return errorj.CreatePrimaryKeysError.Wrap(err, "failed to set primary key").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Table:       quotedTableName,
				PrimaryKeys: table.GetPKFields(),
				Statement:   statement,
			})
	}
	return nil
}

func (m *MySQL) deletePrimaryKey(ctx context.Context, table *Table) error {
	if table.DeletePrimaryKeyNamed == "" {
		return nil
	}

	quotedTableName := m.quotedTableName(table.Name)
	quotedSchema := m.namespacePrefix(table.Namespace)

	query := fmt.Sprintf(mySQLDropPrimaryKeyTemplate, quotedSchema, quotedTableName)

	if _, err := m.txOrDb(ctx).ExecContext(ctx, query); err != nil {
		return errorj.DeletePrimaryKeysError.Wrap(err, "failed to delete primary key").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Table:       quotedTableName,
				PrimaryKeys: table.GetPKFields(),
				Statement:   query,
			})
	}

	return nil
}

func (m *MySQL) createIndex(ctx context.Context, table *Table) error {
	if table.TimestampColumn == "" {
		return nil
	}
	quotedTableName := m.quotedTableName(table.Name)
	quotedNamespace := m.namespacePrefix(table.Namespace)

	statement := fmt.Sprintf(mySQLIndexTemplate, "bulker_timestamp_index",
		quotedNamespace, quotedTableName, m.quotedColumnName(table.TimestampColumn))

	if _, err := m.txOrDb(ctx).ExecContext(ctx, statement); err != nil {
		return errorj.AlterTableError.Wrap(err, "failed to set sort key").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Table:       quotedTableName,
				PrimaryKeys: table.GetPKFields(),
				Statement:   statement,
			})
	}

	return nil
}
