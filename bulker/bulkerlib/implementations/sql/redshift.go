package sql

import (
	"context"
	"database/sql"
	"fmt"
	"math/rand"
	"strings"
	"text/template"
	"time"

	bulker "github.com/jitsucom/bulker/bulkerlib"
	driver "github.com/jitsucom/bulker/bulkerlib/implementations/sql/redshift_driver"
	types2 "github.com/jitsucom/bulker/bulkerlib/types"
	"github.com/jitsucom/bulker/jitsubase/errorj"
	"github.com/jitsucom/bulker/jitsubase/jsonorder"
	"github.com/jitsucom/bulker/jitsubase/timestamp"
	"github.com/jitsucom/bulker/jitsubase/utils"
)

func init() {
	bulker.RegisterBulker(RedshiftBulkerTypeId, NewRedshift)
}

const (
	RedshiftBulkerTypeId = "redshift"

	redshiftCopyTemplate = `copy %s%s (%s)
					from 's3://%s/%s'
    				ACCESS_KEY_ID '%s'
    				SECRET_ACCESS_KEY '%s'
    				region '%s'
    				csv
					gzip
					IGNOREHEADER 1
                    dateformat 'auto'
                    timeformat 'auto'
					TRUNCATECOLUMNS`

	redshiftAlterSortKeyTemplate       = `ALTER TABLE %s%s ALTER SORTKEY (%s)`
	redshiftMergeStatement             = `MERGE INTO {{.Namespace}}{{.TableTo}} USING {{.NamespaceFrom}}{{.TableFrom}} S ON {{.JoinConditions}} WHEN MATCHED THEN UPDATE SET {{.UpdateSet}} WHEN NOT MATCHED THEN INSERT ({{.Columns}}) VALUES ({{.SourceColumns}})`
	redshiftDeleteBeforeBulkMergeUsing = `DELETE FROM %s%s using %s%s where %s`

	redshiftPrimaryKeyFieldsQuery = `select tco.constraint_name as constraint_name, kcu.column_name as key_column
									 from information_schema.table_constraints tco
         							   join information_schema.key_column_usage kcu
             						   on kcu.constraint_name = tco.constraint_name
                                          and kcu.constraint_schema = tco.constraint_schema
 										  and kcu.constraint_name = tco.constraint_name
				                     where tco.table_schema ilike $1 and tco.table_name = $2 and tco.constraint_type = 'PRIMARY KEY'
                                     order by kcu.ordinal_position`
	redshiftGetSortKeyQuery = `SELECT "column" FROM pg_table_def WHERE schemaname ilike $1 AND tablename = $2 and sortkey = 1 and "type" ilike '%timestamp%'`

	redshiftTxIsolationError = "Serializable isolation violation on table"

	credentialsMask = "*****"
)

var (
	redshiftMergeQueryTemplate, _ = template.New("redshiftMergeStatement").Parse(redshiftMergeStatement)

	redshiftTypes = map[types2.DataType][]string{
		types2.STRING:    {"character varying(65535)"},
		types2.INT64:     {"bigint"},
		types2.FLOAT64:   {"double precision"},
		types2.TIMESTAMP: {"timestamp with time zone", "timestamp", "timestamp without time zone"},
		types2.BOOL:      {"boolean"},
		types2.JSON:      {"super"},
		types2.UNKNOWN:   {"character varying(65535)"},
	}
)

// Redshift adapter for creating,patching (schema or table), inserting and copying data from s3 to redshift
type Redshift struct {
	//Aws Redshift uses Postgres fork under the hood
	*Postgres
	s3Config *S3OptionConfig
}

func NewRedshift(bulkerConfig bulker.Config) (bulker.Bulker, error) {
	config := &driver.RedshiftConfig{}
	if err := utils.ParseObject(bulkerConfig.DestinationConfig, config); err != nil {
		return nil, fmt.Errorf("failed to parse destination config: %v", err)
	}
	if config.AuthenticationMethod == "iam" {
		return NewRedshiftIAM(bulkerConfig)
	} else {
		return NewRedshiftClassic(bulkerConfig)
	}
}

// NewRedshift returns configured Redshift adapter instance
func NewRedshiftClassic(bulkerConfig bulker.Config) (bulker.Bulker, error) {
	config := &driver.RedshiftConfig{}
	if err := utils.ParseObject(bulkerConfig.DestinationConfig, config); err != nil {
		return nil, fmt.Errorf("failed to parse destination config: %v", err)
	}
	if config.Port == 0 {
		config.Port = 5439
	}
	if err := config.Validate(); err != nil {
		return nil, err
	}
	bulkerConfig.DestinationConfig = PostgresConfig{DataSourceConfig: DataSourceConfig{
		Host:       config.Host,
		Port:       config.Port,
		Db:         config.Db,
		Schema:     config.Schema,
		Username:   config.Username,
		Password:   config.Password,
		Parameters: config.Parameters,
	}}
	postgres, err := NewPostgres(bulkerConfig)
	if err != nil {
		return nil, err
	}
	typecastFunc := func(placeholder string, column types2.SQLColumn) string {
		if column.DataType == types2.JSON || column.Type == "super" {
			return fmt.Sprintf("JSON_PARSE(%s)", placeholder)
		}
		if column.Override {
			return placeholder + "::" + column.Type
		}
		return placeholder
	}
	r := &Redshift{Postgres: postgres.(*Postgres), s3Config: &S3OptionConfig{
		AccessKeyID:     config.AccessKeyID,
		SecretAccessKey: config.SecretAccessKey,
		Bucket:          config.Bucket,
		Region:          config.Region,
		Folder:          config.Folder,
	}}
	r.batchFileFormat = types2.FileFormatCSV
	r.batchFileCompression = types2.FileCompressionGZIP
	r._columnDDLFunc = redshiftColumnDDL
	r.typecastFunc = typecastFunc
	r.typesMapping, r.reverseTypesMapping = InitTypes(redshiftTypes, true)
	r.tableHelper = NewTableHelper(RedshiftBulkerTypeId, 127, '"')
	r.temporaryTables = true
	r.renameToSchemaless = true
	//// Redshift is case insensitive by default
	//r._columnNameFunc = strings.ToLower
	//r._tableNameFunc = func(config *DataSourceConfig, tableName string) string { return tableName }
	return r, err
}

func (p *Redshift) CreateStream(id, tableName string, mode bulker.BulkMode, streamOptions ...bulker.StreamOption) (bulker.BulkerStream, error) {
	streamOptions = append(streamOptions, withLocalBatchFile(fmt.Sprintf("bulker_%s", utils.SanitizeString(id))))
	if p.s3Config != nil {
		streamOptions = append(streamOptions, withS3BatchFile(p.s3Config))
	}
	if err := p.validateOptions(streamOptions); err != nil {
		return nil, err
	}
	switch mode {
	case bulker.Stream:
		return newAutoCommitStream(id, p, tableName, streamOptions...)
	case bulker.Batch:
		return newTransactionalStream(id, p, tableName, streamOptions...)
	case bulker.ReplaceTable:
		return newReplaceTableStream(id, p, tableName, streamOptions...)
	case bulker.ReplacePartition:
		return newReplacePartitionStream(id, p, tableName, streamOptions...)
	}
	return nil, fmt.Errorf("unsupported bulk mode: %s", mode)
}

func (p *Redshift) validateOptions(streamOptions []bulker.StreamOption) error {
	options := &bulker.StreamOptions{}
	for _, option := range streamOptions {
		options.Add(option)
	}
	return nil
}

// Type returns Postgres type
func (p *Redshift) Type() string {
	return RedshiftBulkerTypeId
}

// OpenTx opens underline sql transaction and return wrapped instance
func (p *Redshift) OpenTx(ctx context.Context) (*TxSQLAdapter, error) {
	return &TxSQLAdapter{sqlAdapter: p, tx: NewDbWrapper(p.Type(), p.dataSource, p.queryLogger, p.checkErrFunc, false)}, nil
	//return p.openTx(ctx, p)
}

func (p *Redshift) Insert(ctx context.Context, table *Table, merge bool, objects ...types2.Object) error {
	if !merge || len(table.GetPKFields()) == 0 {
		return p.insert(ctx, table, objects)
	}
	for _, object := range objects {
		pkMatchConditions := &WhenConditions{}
		for _, pkColumn := range table.GetPKFields() {
			value := object.GetN(pkColumn)
			if value == nil {
				pkMatchConditions = pkMatchConditions.Add(pkColumn, "IS NULL", nil)
			} else {
				pkMatchConditions = pkMatchConditions.Add(pkColumn, "=", value)
			}
		}
		res, err := p.Select(ctx, table.Namespace, table.Name, pkMatchConditions, nil)
		if err != nil {
			return errorj.ExecuteInsertError.Wrap(err, "failed check primary key collision").
				WithProperty(errorj.DBInfo, &types2.ErrorPayload{
					Schema:      p.config.Schema,
					Table:       p.quotedTableName(table.Name),
					PrimaryKeys: table.GetPKFields(),
				})
		}
		if len(res) > 0 {
			return p.Update(ctx, table, object, pkMatchConditions)
		} else {
			return p.insert(ctx, table, []types2.Object{object})
		}
	}
	return nil
}

// LoadTable copy transfer data from s3 to redshift by passing COPY request to redshift
func (p *Redshift) LoadTable(ctx context.Context, targetTable *Table, loadSource *LoadSource) (state bulker.WarehouseState, err error) {
	quotedTableName := p.quotedTableName(targetTable.Name)
	namespace := p.namespacePrefix(targetTable.Namespace)
	if loadSource.Type != AmazonS3 {
		return state, fmt.Errorf("LoadTable: only Amazon S3 file is supported")
	}
	if loadSource.Format != p.batchFileFormat {
		return state, fmt.Errorf("LoadTable: only %s format is supported", p.batchFileFormat)
	}
	columnNames := targetTable.MappedColumnNames(p.quotedColumnName)
	s3Config := loadSource.S3Config
	fileKey := loadSource.Path
	_, _ = p.txOrDb(ctx).ExecContext(ctx, "SET json_parse_truncate_strings=ON")
	statement := fmt.Sprintf(redshiftCopyTemplate, namespace, quotedTableName, strings.Join(columnNames, ","), s3Config.Bucket, fileKey, s3Config.AccessKeyID, s3Config.SecretAccessKey, s3Config.Region)
	if _, err := p.txOrDb(ctx).ExecContext(ctx, statement); err != nil {
		var res *sql.Rows
		if strings.Contains(err.Error(), "Check 'sys_load_error_detail' system table for details.") {
			res, _ = p.dataSource.Query("SELECT error_code, error_message, column_name, column_type, column_length, '' as raw_field_value  FROM sys_load_error_detail where file_name=$1 ORDER BY start_time DESC LIMIT 1", fmt.Sprintf("s3://%s/%s", s3Config.Bucket, fileKey))
		} else if strings.Contains(err.Error(), "Check 'stl_load_errors' system table for details.") {
			res, _ = p.dataSource.Query("SELECT err_code, err_reason, colname, type, col_length, raw_field_value FROM stl_load_errors WHERE filename=$1 ORDER BY starttime DESC LIMIT 1", fmt.Sprintf("s3://%s/%s", s3Config.Bucket, fileKey))
		}
		if res != nil && res.Next() {
			var errorCode, errorMessage, columnName, columnType, columnLength, rawFieldValue string
			if err1 := res.Scan(&errorCode, &errorMessage, &columnName, &columnType, &columnLength, &rawFieldValue); err1 == nil {
				err = fmt.Errorf("Error code %s: %s. Column: '%s' type: %s(%s)%s", strings.TrimSpace(errorCode),
					strings.TrimSpace(errorMessage), strings.TrimSpace(columnName), strings.TrimSpace(columnType), strings.TrimSpace(columnLength),
					utils.Ternary(strings.TrimSpace(rawFieldValue) != "", fmt.Sprintf(" Raw value: %s", strings.TrimSpace(rawFieldValue)), ""))
			}
		}
		return state, errorj.CopyError.Wrap(err, "failed to copy data from s3").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Schema:    p.config.Schema,
				Table:     quotedTableName,
				Statement: fmt.Sprintf(redshiftCopyTemplate, namespace, quotedTableName, strings.Join(columnNames, ","), s3Config.Bucket, fileKey, credentialsMask, credentialsMask, s3Config.Region),
			})
	}

	return state, nil
}

func (p *Redshift) deleteThenCopy(ctx context.Context, targetTable *Table, sourceTable *Table, mergeWindow int) (state bulker.WarehouseState, err error) {
	startTime := time.Now()
	quotedTargetTableName := p.quotedTableName(targetTable.Name)
	namespace := p.namespacePrefix(targetTable.Namespace)
	quotedSourceTableName := p.quotedTableName(sourceTable.Name)
	sourceNamespace := p.namespacePrefix(sourceTable.Namespace)

	tx, err := p.openTx(ctx, p)
	if err != nil {
		return state, err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()
	//delete duplicates from table
	var pkMatchConditions string
	for i, pkColumn := range targetTable.GetPKFields() {
		if i > 0 {
			pkMatchConditions += " AND "
		}
		pkMatchConditions += fmt.Sprintf(`%s.%s = %s.%s`, quotedTargetTableName, pkColumn, quotedSourceTableName, pkColumn)
	}
	if targetTable.TimestampColumn != "" {
		monthBefore := timestamp.Now().AddDate(0, 0, -mergeWindow).UTC()
		pkMatchConditions += " AND " + fmt.Sprintf(`%s.%s >= '%s'`, quotedTargetTableName, p.quotedColumnName(targetTable.TimestampColumn), monthBefore.Format(time.RFC3339))
	}
	deleteStatement := fmt.Sprintf(redshiftDeleteBeforeBulkMergeUsing, namespace, quotedTargetTableName, sourceNamespace, quotedSourceTableName, pkMatchConditions)
	state = bulker.WarehouseState{
		Name:            "delete",
		TimeProcessedMs: time.Since(startTime).Milliseconds(),
	}
	if _, err = tx.tx.ExecContext(ctx, deleteStatement); err != nil {
		return state, err
	}
	ctx = context.WithValue(ctx, ContextTransactionKey, tx.tx)
	state1, err := p.copy(ctx, targetTable, sourceTable)
	state.Merge(state1)
	if err != nil {
		return state, err
	}
	startTime = time.Now()
	err = tx.Commit()
	state.Merge(bulker.WarehouseState{
		Name:            "commit",
		TimeProcessedMs: time.Since(startTime).Milliseconds(),
	})
	return state, err
}

func (p *Redshift) CopyTables(ctx context.Context, targetTable *Table, sourceTable *Table, mergeWindow int, discriminatorColumn string) (state bulker.WarehouseState, err error) {
	if mergeWindow <= 0 {
		return p.copy(ctx, targetTable, sourceTable)
	} else {
		for i := 0; i < 5; i++ {
			var state1 bulker.WarehouseState
			state1, err = p.deleteThenCopy(ctx, targetTable, sourceTable, mergeWindow)
			state.Merge(state1)
			if err != nil {
				if strings.Contains(err.Error(), redshiftTxIsolationError) {
					p.Errorf("Redshift transaction isolation error: %v. Retrying...", err)
					//sleep 30-39s
					time.Sleep(time.Duration(30+rand.Intn(10)) * time.Second)
					continue
				}
			}
			break
		}
		return state, err
	}
}

func (p *Redshift) ReplaceTable(ctx context.Context, targetTableName string, replacementTable *Table, dropOldTable bool) (err error) {
	row := p.txOrDb(ctx).QueryRowContext(ctx, fmt.Sprintf(`SELECT EXISTS (SELECT * FROM information_schema.tables WHERE table_schema ilike '%s' AND table_name = '%s')`, p.NamespaceName(replacementTable.Namespace), targetTableName))
	exists := false
	err = row.Scan(&exists)
	if err != nil {
		return err
	}
	if !exists {
		return p.renameTable(ctx, false, replacementTable.Namespace, replacementTable.Name, targetTableName)
	}
	// rename in 2 ops in transaction
	tx, err := p.openTx(ctx, p)
	if err != nil {
		return err
	}
	ctxTx := context.WithValue(ctx, ContextTransactionKey, tx.tx)
	tmpTable := "deprecated_" + targetTableName + time.Now().Format("_20060102_150405")
	err1 := p.renameTable(ctxTx, false, replacementTable.Namespace, targetTableName, tmpTable)
	err = p.renameTable(ctxTx, false, replacementTable.Namespace, replacementTable.Name, targetTableName)
	if err == nil && err1 == nil {
		err = tx.Commit()
		if dropOldTable && err == nil {
			return p.DropTable(ctx, replacementTable.Namespace, tmpTable, true)
		}
	} else {
		_ = tx.Rollback()
	}
	return
}

// GetTableSchema return table (name,columns, primary key) representation wrapped in Table struct
func (p *Redshift) GetTableSchema(ctx context.Context, namespace string, tableName string) (*Table, error) {
	table, err := p.getTable(ctx, namespace, strings.ToLower(tableName))
	if err != nil {
		return nil, err
	}

	//don't select primary keys of non-existent table
	if table.ColumnsCount() == 0 {
		return table, nil
	}

	primaryKeyName, pkFields, err := p.getPrimaryKeys(ctx, table.Namespace, table.Name)
	if err != nil {
		return nil, err
	}

	table.PKFields = pkFields
	table.PrimaryKeyName = primaryKeyName

	if primaryKeyName != "" && !strings.HasPrefix(primaryKeyName, BulkerManagedPkConstraintPrefix) {
		p.Infof("table: %s.%s has a primary key with name: %s that isn't managed by Jitsu. Custom primary key will be used in rows deduplication and updates. primary_key configuration provided in Jitsu config will be ignored.", p.config.Schema, table.Name, primaryKeyName)
	}
	sortKey, err := p.getSortKey(ctx, table.Namespace, table.Name)
	if err != nil {
		p.Errorf("Failed to get sort key for table %s.%s: %v", table.Namespace, table.Name, err)
	}
	table.TimestampColumn = sortKey

	return table, nil
}

func (p *Redshift) getSortKey(ctx context.Context, namespace, tableName string) (string, error) {
	tableName = p.TableName(tableName)
	namespace = p.NamespaceName(namespace)
	pkFieldsRows, err := p.txOrDb(ctx).QueryContext(ctx, redshiftGetSortKeyQuery, namespace, tableName)
	if err != nil {
		return "", errorj.GetPrimaryKeysError.Wrap(err, "failed to get sort key").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Schema:    namespace,
				Table:     tableName,
				Statement: redshiftGetSortKeyQuery,
				Values:    []any{p.config.Schema, tableName},
			})
	}

	defer pkFieldsRows.Close()
	if pkFieldsRows.Next() {
		var sortKey string
		if err := pkFieldsRows.Scan(&sortKey); err != nil {
			return "", errorj.GetPrimaryKeysError.Wrap(err, "failed to scan result").
				WithProperty(errorj.DBInfo, &types2.ErrorPayload{
					Schema:    namespace,
					Table:     tableName,
					Statement: redshiftGetSortKeyQuery,
					Values:    []any{p.config.Schema, tableName},
				})
		}
		return sortKey, nil
	}
	return "", nil
}

func (p *Redshift) getPrimaryKeys(ctx context.Context, namespace, tableName string) (string, jsonorder.OrderedSet[string], error) {
	tableName = p.TableName(tableName)
	namespace = p.NamespaceName(namespace)
	primaryKeys := jsonorder.NewOrderedSet[string]()
	pkFieldsRows, err := p.txOrDb(ctx).QueryContext(ctx, redshiftPrimaryKeyFieldsQuery, namespace, tableName)
	if err != nil {
		return "", jsonorder.OrderedSet[string]{}, errorj.GetPrimaryKeysError.Wrap(err, "failed to get primary key").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Schema:    namespace,
				Table:     tableName,
				Statement: redshiftPrimaryKeyFieldsQuery,
				Values:    []any{p.config.Schema, tableName},
			})
	}

	defer pkFieldsRows.Close()
	var pkFields []string
	var primaryKeyName string
	for pkFieldsRows.Next() {
		var constraintName, fieldName string
		if err := pkFieldsRows.Scan(&constraintName, &fieldName); err != nil {
			return "", jsonorder.OrderedSet[string]{}, errorj.GetPrimaryKeysError.Wrap(err, "failed to scan result").
				WithProperty(errorj.DBInfo, &types2.ErrorPayload{
					Schema:    namespace,
					Table:     tableName,
					Statement: redshiftPrimaryKeyFieldsQuery,
					Values:    []any{p.config.Schema, tableName},
				})
		}
		if primaryKeyName == "" && constraintName != "" {
			primaryKeyName = constraintName
		}
		pkFields = append(pkFields, fieldName)
	}
	if err := pkFieldsRows.Err(); err != nil {
		return "", jsonorder.OrderedSet[string]{}, errorj.GetPrimaryKeysError.Wrap(err, "failed read last row").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Schema:    namespace,
				Table:     tableName,
				Statement: redshiftPrimaryKeyFieldsQuery,
				Values:    []any{p.config.Schema, tableName},
			})
	}
	for _, field := range pkFields {
		primaryKeys.Put(field)
	}

	return primaryKeyName, primaryKeys, nil
}

// PatchTableSchema RedShift doesnt support altering of primary keys and other constraints, so here we only add new columns
func (p *Redshift) PatchTableSchema(ctx context.Context, patchTable *Table) (*Table, error) {
	quotedTableName := p.quotedTableName(patchTable.Name)
	quotedSchema := p.namespacePrefix(patchTable.Namespace)

	//patch columns
	err := patchTable.Columns.ForEachIndexedE(func(_ int, columnName string, column types2.SQLColumn) error {
		columnDDL := p.columnDDL(columnName, patchTable, column)
		query := fmt.Sprintf(addColumnTemplate, quotedSchema, quotedTableName, columnDDL)

		if _, err := p.txOrDb(ctx).ExecContext(ctx, query); err != nil {
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
	return patchTable, nil
}

func (p *Redshift) TmpNamespace(string) string {
	return NoNamespaceValue
}

func (p *Redshift) CreateTable(ctx context.Context, schemaToCreate *Table) (*Table, error) {
	err := p.createSchemaIfNotExists(ctx, schemaToCreate.Namespace)
	if err != nil {
		return nil, err
	}
	err = p.SQLAdapterBase.CreateTable(ctx, schemaToCreate)
	if err != nil {
		return nil, err
	}
	if !schemaToCreate.Temporary && schemaToCreate.TimestampColumn != "" {
		err = p.createSortKey(ctx, schemaToCreate)
		if err != nil {
			p.DropTable(ctx, schemaToCreate.Namespace, schemaToCreate.Name, true)
			return nil, fmt.Errorf("failed to create sort key: %v", err)
		}
	}
	return schemaToCreate, nil
}

func (p *Redshift) createSortKey(ctx context.Context, table *Table) error {
	if table.TimestampColumn == "" {
		return nil
	}
	quotedTableName := p.quotedTableName(table.Name)
	namespace := p.namespacePrefix(table.Namespace)

	statement := fmt.Sprintf(redshiftAlterSortKeyTemplate,
		namespace, quotedTableName, p.quotedColumnName(table.TimestampColumn))

	if _, err := p.txOrDb(ctx).ExecContext(ctx, statement); err != nil {
		return errorj.AlterTableError.Wrap(err, "failed to set sort key").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Table:       quotedTableName,
				PrimaryKeys: table.GetPKFields(),
				Statement:   statement,
			})
	}

	return nil
}

// redshiftColumnDDL returns column DDL (quoted column name, mapped sql type and 'not null' if pk field)
func redshiftColumnDDL(quotedName, name string, table *Table, column types2.SQLColumn) string {
	var columnConstaints string
	var columnAttributes string

	sqlType := column.GetDDLType()

	if table.PKFields.Contains(name) {
		columnConstaints = " not null " + getDefaultValueStatement(sqlType)
		if table.PKFields.Size() == 1 {
			columnAttributes = " DISTKEY "
		}
	}

	return fmt.Sprintf(`%s %s%s%s`, quotedName, sqlType, columnAttributes, columnConstaints)
}
