package sql

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"
	"text/template"
	"time"

	"github.com/duckdb/duckdb-go/v2"
	_ "github.com/duckdb/duckdb-go/v2"
	bulker "github.com/jitsucom/bulker/bulkerlib"
	types2 "github.com/jitsucom/bulker/bulkerlib/types"
	"github.com/jitsucom/bulker/jitsubase/errorj"
	"github.com/jitsucom/bulker/jitsubase/jsoniter"
	"github.com/jitsucom/bulker/jitsubase/jsonorder"
	"github.com/jitsucom/bulker/jitsubase/logging"
	"github.com/jitsucom/bulker/jitsubase/utils"
	"github.com/jitsucom/bulker/jitsubase/uuid"
)

func init() {
	bulker.RegisterBulker(DuckDBBulkerTypeId, NewDuckDB)
}

const (
	DuckDBBulkerTypeId     = "duckdb"
	DuckDBMemoryDBAlias    = "jitsu_memdb"
	duckDBTableSchemaQuery = `SELECT 
 							column_name AS name,
    						lower(data_type) AS column_type
						FROM information_schema.columns WHERE 
						 table_catalog = $1 AND
						 table_schema ilike $2 AND
						 table_name = $3 order by ordinal_position`
	duckDBPrimaryKeyFieldsQuery = `SELECT tco.constraint_name as constraint_name,
      kcu.column_name as key_column
FROM information_schema.table_constraints tco
        JOIN information_schema.key_column_usage kcu
             ON kcu.constraint_name = tco.constraint_name
                 AND kcu.constraint_schema = tco.constraint_schema
                 AND kcu.constraint_name = tco.constraint_name
WHERE tco.constraint_type = 'PRIMARY KEY' AND 
     kcu.constraint_catalog = $1 AND
     kcu.table_schema ilike $2 AND
     kcu.table_name = $3 order by kcu.ordinal_position`

	duckDBIndexTemplate = `CREATE INDEX %s ON %s%s (%s);`

	duckDBMergeQuery = `INSERT OR REPLACE INTO {{.Namespace}}{{.TableName}}({{.Columns}}) VALUES ({{.Placeholders}})`

	duckDBBulkMergeQuery = `INSERT OR REPLACE INTO {{.Namespace}}{{.TableTo}}({{.Columns}}) SELECT {{.Columns}} FROM {{.NamespaceFrom}}{{.TableFrom}}`
)

var (
	duckDBMergeQueryTemplate, _     = template.New("duckDBMergeQuery").Parse(duckDBMergeQuery)
	duckDBBulkMergeQueryTemplate, _ = template.New("duckDBBulkMergeQuery").Parse(duckDBBulkMergeQuery)

	duckdbDataTypes = map[types2.DataType][]string{
		types2.STRING:    {"text", "varchar", "uuid"},
		types2.INT64:     {"bigint", "int"},
		types2.FLOAT64:   {"double", "float"},
		types2.TIMESTAMP: {"timestamp with time zone", "timestamp", "timestamp without time zone"},
		types2.BOOL:      {"boolean", "bool"},
		types2.JSON:      {"json"},
		types2.UNKNOWN:   {"text"},
	}
)

type DuckDBConfig struct {
	DataSourceConfig `mapstructure:",squash"`
	MotherDuckToken  string `mapstructure:"motherduckToken" json:"motherduckToken" yaml:"motherduckToken"`
}

type DuckDB struct {
	*SQLAdapterBase[DuckDBConfig]
}

func (d *DuckDB) Type() string {
	return DuckDBBulkerTypeId
}

func duckDBDsn(config *DuckDBConfig) string {
	connectionString := fmt.Sprintf("md:%s", config.Db)
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

func NewDuckDB(bulkerConfig bulker.Config) (bulker.Bulker, error) {
	config := &DuckDBConfig{}
	if err := utils.ParseObject(bulkerConfig.DestinationConfig, config); err != nil {
		return nil, fmt.Errorf("failed to parse destination config: %v", err)
	}
	if err := config.Validate(); err != nil {
		return nil, err
	}

	if config.MotherDuckToken != "" {
		utils.MapPutIfAbsent(config.Parameters, "motherduck_token", config.MotherDuckToken)
		utils.MapPutIfAbsent(config.Parameters, "custom_user_agent", "Jitsu")
	}
	utils.MapPutIfAbsent(config.Parameters, "timezone", "UTC")

	typecastFunc := func(placeholder string, column types2.SQLColumn) string {
		if column.Override {
			return placeholder + "::" + column.Type
		}
		return placeholder
	}
	valueMappingFunc := func(value any, valuePresent bool, sqlColumn types2.SQLColumn) any {
		//replace zero byte character for text fields
		if valuePresent {
			if sqlColumn.DataType == types2.STRING {
				switch v := value.(type) {
				case string:
					value = strings.ReplaceAll(v, "\u0000", "")
				case time.Time:
					value = v.UTC().Format(time.RFC3339Nano)
				case nil:
					value = v
				default:
					value = fmt.Sprint(v)
				}
			} else if sqlColumn.DataType == types2.JSON {
				if v, ok := value.(string); ok {
					value = strings.ReplaceAll(v, "\\u0000", "")
				}
			} else if sqlColumn.DataType == types2.TIMESTAMP {
				if v, ok := value.(time.Time); ok {
					value = v.UTC()
				}
			}
		}
		return value
	}
	var queryLogger *logging.QueryLogger
	if bulkerConfig.LogLevel == bulker.Verbose {
		queryLogger = logging.NewQueryLogger(bulkerConfig.Id, os.Stderr, os.Stderr)
	}

	dbConnectFunction := func(ctx context.Context, cfg *DuckDBConfig) (*sql.DB, error) {
		connectionString := duckDBDsn(cfg)
		logging.Infof("[%s] connecting: %s", bulkerConfig.Id, cfg.Db)

		dataSource, err := sql.Open("duckdb", connectionString)
		if err != nil {
			return nil, err
		}
		if err := dataSource.PingContext(ctx); err != nil {
			_ = dataSource.Close()
			return nil, err
		}
		dataSource.SetConnMaxIdleTime(3 * time.Minute)
		dataSource.SetMaxIdleConns(10)
		return dataSource, nil
	}
	sqlAdapterBase, err := newSQLAdapterBase(bulkerConfig.Id, DuckDBBulkerTypeId, config, config.Schema, dbConnectFunction, duckdbDataTypes, queryLogger, typecastFunc, IndexParameterPlaceholder, pgColumnDDL, valueMappingFunc, checkErr, true)
	p := &DuckDB{sqlAdapterBase}
	// some clients have no permission to create tmp tables
	p.temporaryTables = false
	p.tableHelper = NewTableHelper(DuckDBBulkerTypeId, 63, '"')
	return p, err
}

func (d *DuckDB) CreateStream(id, tableName string, mode bulker.BulkMode, streamOptions ...bulker.StreamOption) (bulker.BulkerStream, error) {
	streamOptions = append(streamOptions, withLocalBatchFile(fmt.Sprintf("bulker_%s", utils.SanitizeString(id))))

	if err := d.validateOptions(streamOptions); err != nil {
		return nil, err
	}
	switch mode {
	case bulker.Stream:
		return newAutoCommitStream(id, d, tableName, streamOptions...)
	case bulker.Batch:
		return newTransactionalStream(id, d, tableName, streamOptions...)
	case bulker.ReplaceTable:
		return newReplaceTableStream(id, d, tableName, streamOptions...)
	case bulker.ReplacePartition:
		return newReplacePartitionStream(id, d, tableName, streamOptions...)
	}
	return nil, fmt.Errorf("unsupported bulk mode: %s", mode)
}

func (d *DuckDB) validateOptions(streamOptions []bulker.StreamOption) error {
	options := &bulker.StreamOptions{}
	for _, option := range streamOptions {
		options.Add(option)
	}
	return nil
}

func (d *DuckDB) OpenTx(ctx context.Context) (*TxSQLAdapter, error) {
	con, err := d.dataSource.Conn(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to open connection: %v", err)
	}
	_, err = con.ExecContext(ctx, "ATTACH ':memory:' as "+DuckDBMemoryDBAlias)
	if err != nil && !strings.Contains(err.Error(), "already exists") {
		_ = con.Close()
		return nil, fmt.Errorf("failed to attach memory db: %v", err)
	}

	return &TxSQLAdapter{sqlAdapter: d, tx: NewDbWrapper(d.Type(), con, d.queryLogger, d.checkErrFunc, true)}, nil
}

func (d *DuckDB) createSchemaIfNotExists(ctx context.Context, schema string) error {
	if schema == "" || schema == DuckDBMemoryDBAlias {
		return nil
	}
	n := d.NamespaceName(schema)
	if n == "" {
		return nil
	}
	query := fmt.Sprintf(pgCreateDbSchemaIfNotExistsTemplate, n)

	if _, err := d.txOrDb(ctx).ExecContext(ctx, query); err != nil {
		return errorj.CreateSchemaError.Wrap(err, "failed to create db schema").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Schema:    n,
				Statement: query,
			})
	}
	return nil
}

// InitDatabase creates database schema instance if doesn't exist
func (d *DuckDB) InitDatabase(ctx context.Context) error {
	_ = d.createSchemaIfNotExists(ctx, d.config.Schema)

	return nil
}

// GetTableSchema returns table (name,columns with name and types) representation wrapped in Table struct
func (d *DuckDB) GetTableSchema(ctx context.Context, namespace string, tableName string) (*Table, error) {
	table, err := d.getTable(ctx, namespace, tableName)
	if err != nil {
		return nil, err
	}

	//don't select primary keys of non-existent table
	if table.ColumnsCount() == 0 {
		return table, nil
	}

	primaryKeyName, pkFields, err := d.getPrimaryKey(ctx, namespace, tableName)
	if err != nil {
		return nil, err
	}

	table.PKFields = pkFields
	table.PrimaryKeyName = primaryKeyName

	if primaryKeyName != "" && !strings.HasPrefix(primaryKeyName, BulkerManagedPkConstraintPrefix) {
		d.Infof("table: %s has a primary key with name: %s that isn't managed by Jitsu. Custom primary key will be used in rows deduplication and updates. primary_key configuration provided in Jitsu config will be ignored.", table.Name, primaryKeyName)
	}
	return table, nil
}

func (d *DuckDB) getTable(ctx context.Context, namespace string, tableName string) (*Table, error) {
	db := d.TableName(d.config.Db)
	tableName = d.TableName(tableName)
	namespace = d.NamespaceName(namespace)
	table := &Table{Name: tableName, Namespace: namespace, Columns: NewColumns(0), PKFields: jsonorder.NewOrderedSet[string]()}
	rows, err := d.txOrDb(ctx).QueryContext(ctx, duckDBTableSchemaQuery, db, namespace, tableName)
	if err != nil {
		return nil, errorj.GetTableError.Wrap(err, "failed to get table columns").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Schema:      namespace,
				Table:       tableName,
				PrimaryKeys: table.GetPKFields(),
				Statement:   duckDBTableSchemaQuery,
				Values:      []any{d.config.Schema, tableName},
			})
	}

	defer rows.Close()
	for rows.Next() {
		var columnName, columnType string
		if err := rows.Scan(&columnName, &columnType); err != nil {
			return nil, errorj.GetTableError.Wrap(err, "failed to scan result").
				WithProperty(errorj.DBInfo, &types2.ErrorPayload{
					Schema:      namespace,
					Table:       tableName,
					PrimaryKeys: table.GetPKFields(),
					Statement:   duckDBTableSchemaQuery,
					Values:      []any{d.config.Schema, tableName},
				})
		}
		if columnType == "-" {
			//skip dropped field
			continue
		}
		dt, _ := d.GetDataType(columnType)
		table.Columns.Set(columnName, types2.SQLColumn{Type: columnType, DataType: dt})
	}

	if err := rows.Err(); err != nil {
		return nil, errorj.GetTableError.Wrap(err, "failed read last row").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Schema:      namespace,
				Table:       tableName,
				PrimaryKeys: table.GetPKFields(),
				Statement:   duckDBTableSchemaQuery,
				Values:      []any{d.config.Schema, tableName},
			})
	}

	return table, nil
}

func (d *DuckDB) Insert(ctx context.Context, table *Table, merge bool, objects ...types2.Object) error {
	if !merge {
		return d.insert(ctx, table, objects)
	} else {
		return d.insertOrMerge(ctx, table, objects, duckDBMergeQueryTemplate)
	}
}

func (d *DuckDB) CopyTables(ctx context.Context, targetTable *Table, sourceTable *Table, mergeWindow int, discriminatorColumn string) (bulker.WarehouseState, error) {
	if mergeWindow <= 0 {
		return d.copy(ctx, targetTable, sourceTable)
	} else {
		return d.copyOrMerge(ctx, targetTable, sourceTable, duckDBBulkMergeQueryTemplate, "T", pgBulkMergeSourceAlias, mergeWindow, discriminatorColumn)
	}
}

func (d *DuckDB) LoadTable(ctx context.Context, targetTable *Table, loadSource *LoadSource) (state bulker.WarehouseState, err error) {
	if loadSource.Type != LocalFile {
		return state, fmt.Errorf("LoadTable: only local file is supported")
	}
	if loadSource.Format != d.batchFileFormat {
		return state, fmt.Errorf("LoadTable: only %s format is supported", d.batchFileFormat)
	}

	// MotherDuck doesn't support Appender API
	// so we need to create memory database to use Appender API on it
	memoryTable := targetTable.Clone()
	memoryTable.TimestampColumn = ""
	memoryTable.Namespace = DuckDBMemoryDBAlias
	_, err = d.CreateTable(ctx, memoryTable)
	if err != nil {
		return state, err
	}
	defer func() {
		_ = d.DropTable(ctx, memoryTable.Namespace, memoryTable.Name, true)
	}()

	con, err := d.dataSource.Driver().Open(duckDBDsn(d.config))
	if err != nil {
		return state, err
	}
	defer con.Close()
	err = runStatement(con, "ATTACH ':memory:' as "+DuckDBMemoryDBAlias)
	if err != nil && !strings.Contains(err.Error(), "already exists") {
		return state, fmt.Errorf("failed to attach memory db: %v", err)
	}

	appender, err := duckdb.NewAppender(con, DuckDBMemoryDBAlias, "", memoryTable.Name)
	if err != nil {
		return state, err
	}
	defer appender.Close()

	file, err := os.Open(loadSource.Path)
	if err != nil {
		return state, err
	}
	defer func() {
		_ = file.Close()
	}()
	decoder := jsoniter.NewDecoder(file)
	decoder.UseNumber()
	args := make([]driver.Value, memoryTable.ColumnsCount())
	for {
		var object map[string]any
		err = decoder.Decode(&object)
		if err != nil {
			if err == io.EOF {
				break
			}
			return state, err
		}
		memoryTable.Columns.ForEachIndexed(func(i int, name string, col types2.SQLColumn) {
			val, ok := object[name]
			if ok {
				val, _ = types2.ReformatValue(val)
			}
			v := d.valueMappingFunction(val, ok, col)
			if col.DataType == types2.JSON {
				if vv, ok := v.(string); ok {
					v = json.RawMessage(vv)
				}
			}
			args[i] = v
		})
		err = appender.AppendRow(args...)
		if err != nil {
			return state, err
		}
	}
	if err = appender.Flush(); err != nil {
		return state, err
	}
	s2, err := d.CopyTables(ctx, targetTable, memoryTable, 0, "")
	state.Merge(s2)
	if err != nil {
		return state, err
	}
	return state, nil
}

func runStatement(con driver.Conn, statement string) error {
	stmt, err := con.Prepare(statement)
	if err != nil {
		return err
	}
	defer stmt.Close()
	_, err = stmt.Exec(nil)
	return err
}

// getPrimaryKey returns primary key name and fields
func (d *DuckDB) getPrimaryKey(ctx context.Context, namespace string, tableName string) (string, jsonorder.OrderedSet[string], error) {
	db := d.TableName(d.config.Db)
	tableName = d.TableName(tableName)
	namespace = d.NamespaceName(namespace)
	primaryKeys := jsonorder.NewOrderedSet[string]()
	pkFieldsRows, err := d.txOrDb(ctx).QueryContext(ctx, duckDBPrimaryKeyFieldsQuery, db, namespace, tableName)
	if err != nil {
		return "", jsonorder.OrderedSet[string]{}, errorj.GetPrimaryKeysError.Wrap(err, "failed to get primary key").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Schema:    namespace,
				Table:     tableName,
				Statement: duckDBPrimaryKeyFieldsQuery,
				Values:    []any{d.config.Schema, tableName},
			})
	}

	defer pkFieldsRows.Close()
	var pkFields []string
	var primaryKeyName string
	for pkFieldsRows.Next() {
		var constraintName, keyColumn string
		if err := pkFieldsRows.Scan(&constraintName, &keyColumn); err != nil {
			return "", jsonorder.OrderedSet[string]{}, errorj.GetPrimaryKeysError.Wrap(err, "failed to scan result").
				WithProperty(errorj.DBInfo, &types2.ErrorPayload{
					Schema:    namespace,
					Table:     tableName,
					Statement: duckDBPrimaryKeyFieldsQuery,
					Values:    []any{d.config.Schema, tableName},
				})
		}
		if primaryKeyName == "" && constraintName != "" {
			primaryKeyName = constraintName
		}

		pkFields = append(pkFields, keyColumn)
	}

	if err := pkFieldsRows.Err(); err != nil {
		return "", jsonorder.OrderedSet[string]{}, errorj.GetPrimaryKeysError.Wrap(err, "failed read last row").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Schema:    namespace,
				Table:     tableName,
				Statement: duckDBPrimaryKeyFieldsQuery,
				Values:    []any{d.config.Schema, tableName},
			})
	}

	primaryKeys.PutAll(pkFields)

	return primaryKeyName, primaryKeys, nil
}

func (d *DuckDB) CreateTable(ctx context.Context, schemaToCreate *Table) (*Table, error) {
	err := d.createSchemaIfNotExists(ctx, schemaToCreate.Namespace)
	if err != nil {
		return nil, err
	}
	err = d.SQLAdapterBase.CreateTable(ctx, schemaToCreate)
	if err != nil {
		return nil, err
	}
	if !schemaToCreate.Temporary && schemaToCreate.TimestampColumn != "" {
		err = d.createIndex(ctx, schemaToCreate)
		if err != nil {
			d.DropTable(ctx, schemaToCreate.Namespace, schemaToCreate.Name, true)
			return nil, fmt.Errorf("failed to create sort key: %v", err)
		}
	}
	return schemaToCreate, nil
}

func (d *DuckDB) ReplaceTable(ctx context.Context, targetTableName string, replacementTable *Table, dropOldTable bool) (err error) {
	targetTable := replacementTable.Clone()
	targetTable.Name = targetTableName
	if !targetTable.PKFields.Empty() {
		targetTable.PrimaryKeyName = BuildConstraintName(targetTableName)
	}
	tx, err := d.openTx(ctx, d)
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()
	ctx1 := context.WithValue(ctx, ContextTransactionKey, tx.tx)
	_, err = d.tableHelper.EnsureTableWithoutCaching(ctx1, d, d.ID, targetTable)
	if err != nil {
		return err
	}
	err = d.TruncateTable(ctx1, replacementTable.Namespace, targetTableName)
	if err != nil {
		return err
	}
	_, err = d.CopyTables(ctx1, targetTable, replacementTable, 0, "")
	if err != nil {
		return err
	}
	if dropOldTable {
		err = d.DropTable(ctx1, replacementTable.Namespace, replacementTable.Name, true)
		if err != nil {
			return err
		}
	}
	err = tx.Commit()
	return
}

func (d *DuckDB) createIndex(ctx context.Context, table *Table) error {
	if table.TimestampColumn == "" {
		return nil
	}
	quotedTableName := d.quotedTableName(table.Name)
	quotedSchema := d.namespacePrefix(table.Namespace)
	statement := fmt.Sprintf(duckDBIndexTemplate, "bulker_ts_ind_"+uuid.NewLettersNumbers(), quotedSchema,
		quotedTableName, d.quotedColumnName(table.TimestampColumn))

	if _, err := d.txOrDb(ctx).ExecContext(ctx, statement); err != nil {
		return errorj.AlterTableError.Wrap(err, "failed to set sort key").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Table:       quotedTableName,
				Schema:      quotedSchema,
				PrimaryKeys: table.GetPKFields(),
				Statement:   statement,
			})
	}

	return nil
}
func (d *DuckDB) Ping(ctx context.Context) error {
	err := d.SQLAdapterBase.Ping(ctx)
	if err != nil {
		return err
	}
	return nil
}

// Close underlying sql.DB
func (d *DuckDB) Close() error {
	return d.SQLAdapterBase.Close()
}
