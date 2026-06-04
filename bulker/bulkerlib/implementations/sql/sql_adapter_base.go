package sql

import (
	"context"
	"database/sql"
	"fmt"
	"strconv"
	"strings"
	"text/template"
	"time"

	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/bulker/bulkerlib"
	types2 "github.com/jitsucom/bulker/bulkerlib/types"
	"github.com/jitsucom/bulker/jitsubase/appbase"
	"github.com/jitsucom/bulker/jitsubase/errorj"
	"github.com/jitsucom/bulker/jitsubase/logging"
	"github.com/jitsucom/bulker/jitsubase/timestamp"
	"github.com/jitsucom/bulker/jitsubase/utils"
	"github.com/jitsucom/bulker/jitsubase/uuid"
)

const (
	createTableTemplate     = `CREATE %s TABLE %s%s (%s)`
	addColumnTemplate       = `ALTER TABLE %s%s ADD COLUMN %s`
	dropPrimaryKeyTemplate  = `ALTER TABLE %s%s DROP CONSTRAINT %s`
	alterPrimaryKeyTemplate = `ALTER TABLE %s%s ADD CONSTRAINT %s PRIMARY KEY (%s)`

	deleteQueryTemplate   = `DELETE FROM %s%s WHERE %s`
	selectQueryTemplate   = `SELECT %s FROM %s%s%s%s`
	insertQuery           = `INSERT INTO {{.Namespace}}{{.TableName}}({{.Columns}}) VALUES ({{.Placeholders}})`
	insertFromSelectQuery = `INSERT INTO {{.Namespace}}{{.TableTo}}({{.Columns}}) SELECT {{.Columns}} FROM {{.NamespaceFrom}}{{.TableFrom}}`
	renameTableTemplate   = `ALTER TABLE %s%s%s RENAME TO %s%s`

	updateStatementTemplate = `UPDATE %s%s SET %s WHERE %s`
	dropTableTemplate       = `DROP TABLE %s %s%s`
	truncateTableTemplate   = `TRUNCATE TABLE %s%s`
	deleteAllQueryTemplate  = `DELETE FROM %s%s`

	// that value indicates that table must not use namespace (schema or db) in queries.
	// e.g. for Redshift where temporary tables don't belong to any schema
	NoNamespaceValue = "__jitsu_no_namespace__"
)

var (
	insertQueryTemplate, _           = template.New("insertQuery").Parse(insertQuery)
	insertFromSelectQueryTemplate, _ = template.New("insertFromSelectQuery").Parse(insertFromSelectQuery)

	unmappedValue ValueMappingFunction = func(val any, valPresent bool, column types2.SQLColumn) any {
		return val
	}
)

// DbConnectFunction function is used to connect to database
type DbConnectFunction[T any] func(ctx context.Context, config *T) (*sql.DB, error)

// ColumnDDLFunction generate column DDL for CREATE TABLE statement based on type (SQLColumn) and whether it is used for PK
type ColumnDDLFunction func(quotedName, name string, table *Table, column types2.SQLColumn) string

// TableFunction type for all table operations
type TableFunction func(ctx context.Context, table *Table) error

// ValueMappingFunction maps object value to database value. For cases such default value substitution for null or missing values
type ValueMappingFunction func(value any, valuePresent bool, column types2.SQLColumn) any

// TypeCastFunction wraps parameter(or placeholder) to a type cast expression if it is necessary (e.g. on types overrides)
type TypeCastFunction func(placeholder string, column types2.SQLColumn) string

// ErrorAdapter is used to extract implementation specific payload and adapt to standard error
type ErrorAdapter func(error) error

func BuildConstraintName(tableName string) string {
	return fmt.Sprintf("%s%s", BulkerManagedPkConstraintPrefix, uuid.NewLettersNumbers())
}

type SQLAdapterBase[T any] struct {
	appbase.Service
	typeId string
	// schema dataset or database
	namespace            string
	config               *T
	dataSource           *sql.DB
	queryLogger          *logging.QueryLogger
	batchFileFormat      types2.FileFormat
	batchFileCompression types2.FileCompression
	temporaryTables      bool
	tmpTableUsePK        bool
	doLocalDeduplication bool
	renameToSchemaless   bool
	// stringifyObjects objects types like JSON, array will be stringified before sent to warehouse (warehouse will parse them back)
	stringifyObjects bool

	typesMapping        map[types2.DataType]string
	reverseTypesMapping map[string]types2.DataType

	dbConnectFunction    DbConnectFunction[T]
	parameterPlaceholder ParameterPlaceholder
	typecastFunc         TypeCastFunction
	valueMappingFunction ValueMappingFunction
	_columnDDLFunc       ColumnDDLFunction
	tableHelper          TableHelper
	checkErrFunc         ErrorAdapter
	createPKFunc         TableFunction
	dropPKFunc           TableFunction
}

func newSQLAdapterBase[T any](id string, typeId string, config *T, namespace string, dbConnectFunction DbConnectFunction[T], dataTypes map[types2.DataType][]string, queryLogger *logging.QueryLogger, typecastFunc TypeCastFunction, parameterPlaceholder ParameterPlaceholder, columnDDLFunc ColumnDDLFunction, valueMappingFunction ValueMappingFunction, checkErrFunc ErrorAdapter, supportsJSON bool) (*SQLAdapterBase[T], error) {
	s := SQLAdapterBase[T]{
		Service:              appbase.NewServiceBase(id),
		typeId:               typeId,
		config:               config,
		namespace:            namespace,
		dbConnectFunction:    dbConnectFunction,
		queryLogger:          queryLogger,
		parameterPlaceholder: parameterPlaceholder,
		typecastFunc:         typecastFunc,
		valueMappingFunction: valueMappingFunction,
		_columnDDLFunc:       columnDDLFunc,
		checkErrFunc:         checkErrFunc,
		stringifyObjects:     true,
	}
	s.temporaryTables = true
	s.tmpTableUsePK = true
	s.doLocalDeduplication = true
	s.batchFileFormat = types2.FileFormatNDJSON
	s.batchFileCompression = types2.FileCompressionNONE
	var err error
	ctx, cancel := context.WithTimeout(context.Background(), time.Second*290)
	defer cancel()
	s.dataSource, err = dbConnectFunction(ctx, config)
	s.typesMapping, s.reverseTypesMapping = InitTypes(dataTypes, supportsJSON)
	return &s, err
}

func InitTypes(dataTypes map[types2.DataType][]string, supportsJSON bool) (typesMapping map[types2.DataType]string, reverseTypesMapping map[string]types2.DataType) {
	typeMapping := make(map[types2.DataType]string, len(dataTypes))
	reverseTypeMapping := make(map[string]types2.DataType, len(dataTypes)+3)
	for dataType, dbTypes := range dataTypes {
		for i, dbType := range dbTypes {
			if i == 0 {
				typeMapping[dataType] = dbType
			}
			if dataType != types2.UNKNOWN && (dataType != types2.JSON || supportsJSON) {
				reverseTypeMapping[dbType] = dataType
			}
		}
	}
	return typeMapping, reverseTypeMapping
}

// Type returns Postgres type
func (b *SQLAdapterBase[T]) Type() string {
	return b.typeId
}

func (b *SQLAdapterBase[T]) GetBatchFileFormat() types2.FileFormat {
	return b.batchFileFormat
}

func (b *SQLAdapterBase[T]) GetBatchFileCompression() types2.FileCompression {
	return b.batchFileCompression
}

func (b *SQLAdapterBase[T]) StringifyObjects() bool {
	return b.stringifyObjects
}

func (b *SQLAdapterBase[T]) Ping(ctx context.Context) error {
	if b.dataSource != nil {
		err := b.dataSource.PingContext(ctx)
		if err != nil {
			dataSource, err := b.dbConnectFunction(ctx, b.config)
			if err == nil {
				_ = b.dataSource.Close()
				b.dataSource = dataSource
				return nil
			} else {
				return fmt.Errorf("failed to connect to %s. error: %v", b.typeId, err)
			}
		}
	} else {
		var err error
		b.dataSource, err = b.dbConnectFunction(ctx, b.config)
		if err != nil {
			return fmt.Errorf("failed to connect to %s. error: %v", b.typeId, err)
		}
	}
	return nil
}

// Close underlying sql.DB
func (b *SQLAdapterBase[T]) Close() error {
	if b.dataSource != nil {
		return b.dataSource.Close()
	}
	return nil
}

// OpenTx opens underline sql transaction and return wrapped instance
func (b *SQLAdapterBase[T]) openTx(ctx context.Context, sqlAdapter SQLAdapter) (*TxSQLAdapter, error) {
	tx, err := b.dataSource.BeginTx(ctx, nil)
	if err != nil {
		return nil, errorj.BeginTransactionError.Wrap(err, "failed to begin transaction")
	}

	return &TxSQLAdapter{sqlAdapter: sqlAdapter, tx: NewTxWrapper(b.Type(), tx, b.queryLogger, b.checkErrFunc)}, nil
}

func (b *SQLAdapterBase[T]) txOrDb(ctx context.Context) TxOrDB {
	txOrDb, ok := ctx.Value(ContextTransactionKey).(TxOrDB)
	if !ok {
		if b.dataSource == nil {
			return NewDbWrapper(b.typeId, nil, b.queryLogger, b.checkErrFunc, false)
		} else {
			return NewDbWrapper(b.typeId, b.dataSource, b.queryLogger, b.checkErrFunc, false)
		}
	}
	return txOrDb
}

func (b *SQLAdapterBase[T]) Select(ctx context.Context, namespace string, tableName string, whenConditions *WhenConditions, orderBy []string) ([]map[string]any, error) {
	return b.selectFrom(ctx, selectQueryTemplate, namespace, tableName, "*", whenConditions, orderBy)
}
func (b *SQLAdapterBase[T]) selectFrom(ctx context.Context, statement string, namespace string, tableName string, selectExpression string, whenConditions *WhenConditions, orderBy []string) ([]map[string]any, error) {
	quotedTableName := b.tableHelper.quotedTableName(tableName)
	quotedSchema := b.namespacePrefix(namespace)

	whenCondition, values := b.ToWhenConditions(whenConditions, b.parameterPlaceholder, 0)
	if whenCondition != "" {
		whenCondition = " WHERE " + whenCondition
	}
	orderByClause := ""
	if len(orderBy) > 0 {
		quotedOrderByColumns := make([]string, len(orderBy))
		for i, col := range orderBy {
			quotedOrderByColumns[i] = fmt.Sprintf("%s asc", b.quotedColumnName(col))
		}
		orderByClause = " ORDER BY " + strings.Join(quotedOrderByColumns, ", ")
	}
	var rows *sql.Rows
	var err error
	query := fmt.Sprintf(statement, selectExpression, quotedSchema, quotedTableName, whenCondition, orderByClause)
	if b.typeId == MySQLBulkerTypeId {
		//For MySQL using Prepared statement switches mySQL to use Binary protocol that preserves types information
		var stmt *sql.Stmt
		stmt, err = b.txOrDb(ctx).PrepareContext(ctx, query)
		if err == nil {
			defer func() {
				_ = stmt.Close()
			}()
			rows, err = stmt.QueryContext(ctx, values...)
		}
	} else {
		rows, err = b.txOrDb(ctx).QueryContext(ctx, query, values...)
	}
	if err != nil {
		return nil, errorj.SelectFromTableError.Wrap(err, "failed execute select").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Table:     quotedTableName,
				Statement: query,
				Values:    values,
			})
	}

	defer rows.Close()
	var result []map[string]any
	for rows.Next() {
		var row map[string]any
		row, err = rowToMap(rows)
		if err != nil {
			break
		}
		result = append(result, row)
	}

	if err == nil {
		err = rows.Err()
	}
	if err != nil {
		return nil, errorj.SelectFromTableError.Wrap(err, "failed read selected rows").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Table:     quotedTableName,
				Statement: query,
				Values:    values,
			})
	}

	return result, nil
}

func (b *SQLAdapterBase[T]) Count(ctx context.Context, namespace string, tableName string, whenConditions *WhenConditions) (int, error) {
	res, err := b.selectFrom(ctx, selectQueryTemplate, namespace, tableName, "count(*) as jitsu_count", whenConditions, nil)
	if err != nil {
		return -1, err
	}
	if len(res) == 0 {
		return -1, fmt.Errorf("select count * gave no result")
	}
	scnt := res[0]["jitsu_count"]
	return strconv.Atoi(fmt.Sprint(scnt))
}

func (b *SQLAdapterBase[T]) Delete(ctx context.Context, namespace string, tableName string, deleteConditions *WhenConditions) error {
	quotedTableName := b.quotedTableName(tableName)
	quotedSchema := b.namespacePrefix(namespace)

	deleteCondition, values := b.ToWhenConditions(deleteConditions, b.parameterPlaceholder, 0)
	query := fmt.Sprintf(deleteQueryTemplate, quotedSchema, quotedTableName, deleteCondition)

	if _, err := b.txOrDb(ctx).ExecContext(ctx, query, values...); err != nil {

		return errorj.DeleteFromTableError.Wrap(err, "failed to delete data").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Table:     quotedTableName,
				Statement: query,
			})
	}

	return nil
}

func (b *SQLAdapterBase[T]) Update(ctx context.Context, table *Table, object types2.Object, whenConditions *WhenConditions) error {
	quotedTableName := b.quotedTableName(table.Name)
	quotedSchema := b.namespacePrefix(table.Namespace)

	count := object.Len()

	updateCondition, updateValues := b.ToWhenConditions(whenConditions, b.parameterPlaceholder, count)
	columns := make([]string, count)
	values := make([]any, count+len(updateValues), count+len(updateValues))
	i := 0
	for el := object.Front(); el != nil; el = el.Next() {
		name := el.Key
		column := table.Columns.GetN(name)
		columns[i] = b.quotedColumnName(name) + "= " + b.parameterPlaceholder(i+1, name) //$0 - wrong
		values[i] = b.valueMappingFunction(el.Value, true, column)
		i++
	}
	for a := 0; a < len(updateValues); a++ {
		values[i+a] = updateValues[a]
	}

	statement := fmt.Sprintf(updateStatementTemplate, quotedSchema, quotedTableName, strings.Join(columns, ", "), updateCondition)

	if _, err := b.txOrDb(ctx).ExecContext(ctx, statement, values...); err != nil {

		return errorj.UpdateError.Wrap(err, "failed to update").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Table:     quotedTableName,
				Statement: statement,
				Values:    values,
			})
	}

	return nil
}

func (b *SQLAdapterBase[T]) DropTable(ctx context.Context, namespace string, tableName string, ifExists bool) error {
	quotedTableName := b.quotedTableName(tableName)
	quotedSchema := b.namespacePrefix(namespace)

	ifExs := ""
	if ifExists {
		ifExs = "IF EXISTS "
	}
	query := fmt.Sprintf(dropTableTemplate, ifExs, quotedSchema, quotedTableName)

	if _, err := b.txOrDb(ctx).ExecContext(ctx, query); err != nil {

		return errorj.DropError.Wrap(err, "failed to drop table").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Table:     quotedTableName,
				Statement: query,
			})
	}

	return nil
}

func (b *SQLAdapterBase[T]) Drop(ctx context.Context, table *Table, ifExists bool) error {
	return b.DropTable(ctx, table.Namespace, table.Name, ifExists)
}

func (b *SQLAdapterBase[T]) TruncateTable(ctx context.Context, namespace string, tableName string) error {
	quotedTableName := b.quotedTableName(tableName)
	quotedSchema := b.namespacePrefix(namespace)

	statement := fmt.Sprintf(truncateTableTemplate, quotedSchema, quotedTableName)
	if _, err := b.txOrDb(ctx).ExecContext(ctx, statement); err != nil {
		return errorj.TruncateError.Wrap(err, "failed to truncate table").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Table:     quotedTableName,
				Statement: statement,
			})
	}

	return nil
}

// DeleteAll deletes all records in tableName table
func (b *SQLAdapterBase[T]) DeleteAll(ctx context.Context, namespace, tableName string) error {
	quotedTableName := b.quotedTableName(tableName)
	quotedSchema := b.namespacePrefix(namespace)

	statement := fmt.Sprintf(deleteAllQueryTemplate, quotedSchema, quotedTableName)
	if _, err := b.txOrDb(ctx).ExecContext(ctx, statement); err != nil {
		return errorj.TruncateError.Wrap(err, "failed to delete all from table").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Table:     quotedTableName,
				Statement: statement,
			})
	}

	return nil
}

type QueryPayload struct {
	Namespace         string
	NamespaceFrom     string
	TableName         string
	Columns           string
	Placeholders      string
	PrimaryKeyName    string
	PrimaryKeyColumns string
	Discriminator     string
	UpdateSet         string

	TableTo        string
	TableFrom      string
	DedupTable     string
	JoinConditions string
	SourceColumns  string
	ChangeFilter   string
}

func (b *SQLAdapterBase[T]) insert(ctx context.Context, table *Table, objects []types2.Object) error {
	return b.insertOrMerge(ctx, table, objects, nil)
}

// plainInsert inserts provided object into Snowflake
func (b *SQLAdapterBase[T]) insertOrMerge(ctx context.Context, table *Table, objects []types2.Object, mergeQuery *template.Template) error {
	quotedTableName := b.quotedTableName(table.Name)
	quotedSchema := b.namespacePrefix(table.Namespace)
	count := table.ColumnsCount()
	columnNames := make([]string, count)
	placeholders := make([]string, count)
	values := make([]any, count)
	var updateColumns []string
	if mergeQuery != nil {
		updateColumns = make([]string, count)
	}
	table.Columns.ForEachIndexed(func(i int, name string, col types2.SQLColumn) {
		columnName := b.quotedColumnName(name)
		columnNames[i] = columnName
		if mergeQuery != nil {
			updateColumns[i] = fmt.Sprintf(`%s=%s`, columnName, b.typecastFunc(b.parameterPlaceholder(i+1, columnName), col))
		}
		placeholders[i] = b.typecastFunc(b.parameterPlaceholder(i+1, name), col)
	})

	insertPayload := QueryPayload{
		Namespace:      quotedSchema,
		TableName:      quotedTableName,
		Columns:        strings.Join(columnNames, ", "),
		Placeholders:   strings.Join(placeholders, ", "),
		PrimaryKeyName: table.PrimaryKeyName,
		UpdateSet:      strings.Join(updateColumns, ","),
	}
	buf := strings.Builder{}
	template := insertQueryTemplate
	if mergeQuery != nil {
		template = mergeQuery
	}
	err := template.Execute(&buf, insertPayload)
	if err != nil {
		return errorj.ExecuteInsertError.Wrap(err, "failed to build query from template")
	}
	statement := buf.String()
	for _, object := range objects {
		table.Columns.ForEachIndexed(func(i int, name string, sqlColumn types2.SQLColumn) {
			value, valuePresent := object.Get(name)
			values[i] = b.valueMappingFunction(value, valuePresent, sqlColumn)
		})
		if mergeQuery != nil && b.parameterPlaceholder(1, "dummy") == "?" {
			// Without positional parameters we need to duplicate values for placeholders in UPDATE part
			values = append(values, values...)
		}
		_, err := b.txOrDb(ctx).ExecContext(ctx, statement, values...)
		if err != nil {
			return errorj.ExecuteInsertError.Wrap(err, "failed to execute single insert").
				WithProperty(errorj.DBInfo, &types2.ErrorPayload{
					Table:       quotedTableName,
					PrimaryKeys: table.GetPKFields(),
					Statement:   statement,
					Values:      values,
				})
		}
	}

	return nil
}

func (b *SQLAdapterBase[T]) copy(ctx context.Context, targetTable *Table, sourceTable *Table) (state bulkerlib.WarehouseState, err error) {
	return b.copyOrMerge(ctx, targetTable, sourceTable, nil, "", "", 365, "")
}

func (b *SQLAdapterBase[T]) copyOrMerge(ctx context.Context, targetTable *Table, sourceTable *Table, mergeQuery *template.Template, targetAlias string, sourceAlias string, mergeWindow int, discriminator string) (state bulkerlib.WarehouseState, err error) {
	startTime := time.Now()
	quotedSchema := b.namespacePrefix(targetTable.Namespace)
	quotedSchemaFrom := b.namespacePrefix(sourceTable.Namespace)
	quotedTargetTableName := b.quotedTableName(targetTable.Name)
	quotedSourceTableName := b.quotedTableName(sourceTable.Name)

	//insert from select
	count := sourceTable.ColumnsCount()
	columnNames := sourceTable.MappedColumnNames(b.quotedColumnName)
	var updateColumns []string
	var insertColumns []string
	var joinConditions []string
	var pkColumns []string

	if mergeQuery != nil {
		updateColumns = make([]string, count)
		insertColumns = make([]string, count)
		sourceTable.Columns.ForEachIndexed(func(i int, _ string, col types2.SQLColumn) {
			colName := columnNames[i]
			updateColumns[i] = fmt.Sprintf(`%s=%s.%s`, colName, sourceAlias, colName)
			insertColumns[i] = b.typecastFunc(fmt.Sprintf(`%s.%s`, sourceAlias, colName), col)
		})
		targetTable.PKFields.ForEach(func(pkField string) {
			pkName := b.quotedColumnName(pkField)
			joinConditions = append(joinConditions, fmt.Sprintf("%s.%s = %s.%s", targetAlias, pkName, sourceAlias, pkName))
		})
		pkColumns = utils.ArrayMap(targetTable.GetPKFields(), b.quotedColumnName)
		if mergeWindow > 0 && targetTable.TimestampColumn != "" {
			startDate := timestamp.Now().AddDate(0, 0, -mergeWindow).UTC()
			timestampColName := b.quotedColumnName(targetTable.TimestampColumn)
			// for now only snowflake using it so dialect is only snowflake compatible
			joinConditions = append(joinConditions, fmt.Sprintf("%s.%s >= TO_TIMESTAMP_TZ('%s')", targetAlias, timestampColName, startDate.Format(time.RFC3339)))
		}
	}
	insertPayload := QueryPayload{
		Namespace:         quotedSchema,
		NamespaceFrom:     quotedSchemaFrom,
		TableTo:           quotedTargetTableName,
		TableFrom:         quotedSourceTableName,
		Columns:           strings.Join(columnNames, ","),
		PrimaryKeyName:    targetTable.PrimaryKeyName,
		PrimaryKeyColumns: strings.Join(pkColumns, ","),
		Discriminator:     discriminator,
		JoinConditions:    strings.Join(joinConditions, " AND "),
		SourceColumns:     strings.Join(insertColumns, ", "),
		UpdateSet:         strings.Join(updateColumns, ","),
	}
	buf := strings.Builder{}
	queryTemplate := insertFromSelectQueryTemplate
	if mergeQuery != nil {
		queryTemplate = mergeQuery
	}
	err = queryTemplate.Execute(&buf, insertPayload)
	if err != nil {
		return state, errorj.ExecuteInsertError.Wrap(err, "failed to build query from template")
	}
	statement := buf.String()

	if _, err := b.txOrDb(ctx).ExecContext(ctx, statement); err != nil {

		return state, errorj.BulkMergeError.Wrap(err, "failed to bulk insert").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Table:       quotedTargetTableName,
				PrimaryKeys: targetTable.GetPKFields(),
				Statement:   statement,
			})
	}
	return bulkerlib.WarehouseState{
		Name:            utils.Ternary(mergeQuery != nil, "merge", "copy"),
		TimeProcessedMs: time.Since(startTime).Milliseconds(),
	}, nil
}

// CreateTable create table columns and pk key
// override input table sql type with configured cast type
// make fields from Table PkFields - 'not null'
func (b *SQLAdapterBase[T]) CreateTable(ctx context.Context, schemaToCreate *Table) error {
	if err := b.createTableOnly(ctx, schemaToCreate); err != nil {
		return err
	}

	if err := b.createPrimaryKey(ctx, schemaToCreate); err != nil {
		return err
	}

	return nil
}

func (b *SQLAdapterBase[T]) createTableOnly(ctx context.Context, schemaToCreate *Table) error {
	quotedTableName := b.quotedTableName(schemaToCreate.Name)
	quotedSchema := b.namespacePrefix(schemaToCreate.Namespace)

	columnsDDL := schemaToCreate.MappedColumns(func(columnName string, column types2.SQLColumn) string {
		return b.columnDDL(columnName, schemaToCreate, column)
	})
	temporary := ""
	if b.temporaryTables && schemaToCreate.Temporary {
		temporary = "TEMPORARY"
	}

	query := fmt.Sprintf(createTableTemplate, temporary, quotedSchema, quotedTableName, strings.Join(columnsDDL, ", "))

	if _, err := b.txOrDb(ctx).ExecContext(ctx, query); err != nil {
		return errorj.CreateTableError.Wrap(err, "failed to create table").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Table:       quotedTableName,
				PrimaryKeys: schemaToCreate.GetPKFields(),
				Statement:   query,
			})
	}
	return nil
}

// PatchTableSchema alter table with columns (if not empty)
// recreate primary key (if not empty) or delete primary key if Table.DeletePrimaryKeyNamed is true
func (b *SQLAdapterBase[T]) PatchTableSchema(ctx context.Context, patchTable *Table) (*Table, error) {
	quotedTableName := b.quotedTableName(patchTable.Name)
	quotedSchema := b.namespacePrefix(patchTable.Namespace)

	//patch columns
	err := patchTable.Columns.ForEachIndexedE(func(_ int, columnName string, column types2.SQLColumn) error {
		columnDDL := b.columnDDL(columnName, patchTable, column)
		query := fmt.Sprintf(addColumnTemplate, quotedSchema, quotedTableName, columnDDL)

		if _, err := b.txOrDb(ctx).ExecContext(ctx, query); err != nil {
			return errorj.PatchTableError.Wrap(err, "failed to patch table").
				WithProperty(errorj.DBInfo, &types2.ErrorPayload{
					Table:       quotedTableName,
					PrimaryKeys: patchTable.GetPKFields(),
					Statement:   query,
				})
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	//patch primary keys - delete old
	if patchTable.DeletePrimaryKeyNamed != "" {
		err := b.deletePrimaryKey(ctx, patchTable)
		if err != nil {
			return nil, err
		}
	}

	//patch primary keys - create new
	if patchTable.PKFields.Size() > 0 {
		err := b.createPrimaryKey(ctx, patchTable)
		if err != nil {
			return nil, err
		}
	}

	return patchTable, nil
}

// createPrimaryKey create primary key constraint
func (b *SQLAdapterBase[T]) createPrimaryKey(ctx context.Context, table *Table) error {
	if table.PKFields.Empty() {
		return nil
	}
	if b.createPKFunc != nil {
		return b.createPKFunc(ctx, table)
	}

	quotedTableName := b.quotedTableName(table.Name)
	quotedSchema := b.namespacePrefix(table.Namespace)

	columnNames := make([]string, table.PKFields.Size())
	for i, column := range table.GetPKFields() {
		columnNames[i] = b.quotedColumnName(column)
	}

	if table.PrimaryKeyName == "" {
		table.PrimaryKeyName = BuildConstraintName(table.Name)
	}

	statement := fmt.Sprintf(alterPrimaryKeyTemplate, quotedSchema,
		quotedTableName, b.quotedTableName(table.PrimaryKeyName), strings.Join(columnNames, ","))

	if _, err := b.txOrDb(ctx).ExecContext(ctx, statement); err != nil {
		return errorj.CreatePrimaryKeysError.Wrap(err, "failed to set primary key").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Table:       quotedTableName,
				PrimaryKeys: table.GetPKFields(),
				Statement:   statement,
			})
	}

	return nil
}

// delete primary key
func (b *SQLAdapterBase[T]) deletePrimaryKey(ctx context.Context, table *Table) error {
	if table.DeletePrimaryKeyNamed == "" {
		return nil
	}
	if b.dropPKFunc != nil {
		return b.dropPKFunc(ctx, table)
	}

	quotedTableName := b.quotedTableName(table.Name)
	quotedSchema := b.namespacePrefix(table.Namespace)

	query := fmt.Sprintf(dropPrimaryKeyTemplate, quotedSchema, quotedTableName, b.quotedTableName(table.DeletePrimaryKeyNamed))

	if _, err := b.txOrDb(ctx).ExecContext(ctx, query); err != nil {
		return errorj.DeletePrimaryKeysError.Wrap(err, "failed to delete primary key").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Table:       quotedTableName,
				PrimaryKeys: table.GetPKFields(),
				Statement:   query,
			})
	}

	return nil
}

func (b *SQLAdapterBase[T]) renameTable(ctx context.Context, ifExists bool, namespace, tableName, newTableName string) error {
	quotedTableName := b.quotedTableName(tableName)
	quotedNewTableName := b.quotedTableName(newTableName)
	quotedSchema := b.namespacePrefix(namespace)
	renameToSchema := utils.Ternary(b.renameToSchemaless, "", quotedSchema)
	ifExs := ""
	if ifExists {
		ifExs = "IF EXISTS "
	}
	query := fmt.Sprintf(renameTableTemplate, ifExs, quotedSchema, quotedTableName, renameToSchema, quotedNewTableName)

	if _, err := b.txOrDb(ctx).ExecContext(ctx, query); err != nil {
		return errorj.RenameError.Wrap(err, "failed to rename table").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Table:     quotedTableName,
				Statement: query,
			})
	}

	return nil
}

func (b *SQLAdapterBase[T]) ReplaceTable(ctx context.Context, targetTableName string, replacementTable *Table, dropOldTable bool) (err error) {
	tmpTable := "deprecated_" + targetTableName + time.Now().Format("_20060102_150405")
	err1 := b.renameTable(ctx, true, replacementTable.Namespace, targetTableName, tmpTable)
	err = b.renameTable(ctx, false, replacementTable.Namespace, replacementTable.Name, targetTableName)
	if dropOldTable && err1 == nil && err == nil {
		return b.DropTable(ctx, replacementTable.Namespace, tmpTable, true)
	} else if err != nil {
		return multierror.Append(err, err1).ErrorOrNil()
	}
	return
}

func (b *SQLAdapterBase[T]) TableHelper() *TableHelper {
	return &b.tableHelper
}

func (b *SQLAdapterBase[T]) columnDDL(name string, table *Table, column types2.SQLColumn) string {
	quoted, unquoted := b.tableHelper.adaptColumnName(name)
	return b._columnDDLFunc(quoted, unquoted, table, column)
}

// quotedColumnName adapts table name to sql identifier rules of database and quotes accordingly (if needed)
func (b *SQLAdapterBase[T]) quotedTableName(tableName string) string {
	return b.tableHelper.quotedTableName(tableName)
}

func (b *SQLAdapterBase[T]) NamespaceName(namespace string) string {
	if namespace == NoNamespaceValue {
		return ""
	}
	return b.tableHelper.TableName(utils.DefaultString(namespace, b.namespace))
}

func (b *SQLAdapterBase[T]) namespacePrefix(namespace string) string {
	if namespace == NoNamespaceValue {
		return ""
	}
	return b.tableHelper.quotedTableName(utils.DefaultString(namespace, b.namespace)) + "."
}

// quotedColumnName adapts column name to sql identifier rules of database and quotes accordingly (if needed)
func (b *SQLAdapterBase[T]) quotedColumnName(columnName string) string {
	return b.tableHelper.quotedColumnName(columnName)
}

func (b *SQLAdapterBase[T]) ColumnName(identifier string) string {
	return b.tableHelper.ColumnName(identifier)
}

func (b *SQLAdapterBase[T]) TableName(identifier string) string {
	return b.tableHelper.TableName(identifier)
}

// ToWhenConditions generates WHEN clause for SQL query based on provided WhenConditions
//
// paramExpression - SQLParameterExpression function that produce parameter placeholder for parametrized query,
// depending on database can be: IndexParameterPlaceholder, QuestionMarkParameterPlaceholder, NamedParameterPlaceholder
//
// valuesShift - for parametrized query index of first when clause value in all values provided to query
// (for UPDATE queries 'valuesShift' = len(object fields))
func (b *SQLAdapterBase[T]) ToWhenConditions(conditions *WhenConditions, paramExpression ParameterPlaceholder, valuesShift int) (string, []any) {
	if conditions == nil {
		return "", []any{}
	}
	var queryConditions []string
	var values []any

	for i, condition := range conditions.Conditions {
		switch strings.ToLower(condition.Clause) {
		case "is null":
		case "is not null":
			queryConditions = append(queryConditions, b.quotedColumnName(condition.Field)+" "+condition.Clause)
		default:
			queryConditions = append(queryConditions, b.quotedColumnName(condition.Field)+" "+condition.Clause+" "+paramExpression(i+valuesShift+1, condition.Field))
			v, _ := types2.ReformatValue(condition.Value)
			values = append(values, v)
		}
	}

	return strings.Join(queryConditions, " "+conditions.JoinCondition+" "), values
}

func (b *SQLAdapterBase[T]) GetSQLType(dataType types2.DataType) (string, bool) {
	v, ok := b.typesMapping[dataType]
	return v, ok
}

func (b *SQLAdapterBase[T]) GetDataType(sqlType string) (types2.DataType, bool) {
	v, ok := b.reverseTypesMapping[sqlType]
	if !ok {
		for k, v := range b.reverseTypesMapping {
			if match(sqlType, k) {
				return v, true
			}
		}
	}
	return v, ok
}

func (b *SQLAdapterBase[T]) GetAvroType(sqlType string) (any, bool) {
	return "", false
}

func (b *SQLAdapterBase[T]) GetAvroSchema(table *Table) *types2.AvroSchema {
	// not really an avro schema in a base driver
	return nil
}

func (b *SQLAdapterBase[T]) DefaultNamespace() string {
	return b.namespace
}

func (b *SQLAdapterBase[T]) TmpNamespace(targetNamespace string) string {
	return targetNamespace
}

func (b *SQLAdapterBase[T]) TmpTableUsePK() bool {
	return b.tmpTableUsePK
}

func (b *SQLAdapterBase[T]) DoLocalDeduplication() bool {
	return b.doLocalDeduplication
}

func match(target, pattern string) bool {
	suff := pattern[0] == '%'
	pref := pattern[len(pattern)-1] == '%'
	pattern = strings.Trim(pattern, "%")
	if pref && suff {
		return strings.Contains(target, pattern)
	} else if suff {
		return strings.HasSuffix(target, pattern)
	} else {
		return strings.HasPrefix(target, pattern)
	}
}

func checkNotExistErr(err error) error {
	if notExistRegexp.MatchString(err.Error()) {
		return ErrTableNotExist
	}
	return err
}
