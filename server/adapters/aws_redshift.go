package adapters

import (
	"context"
	"fmt"
	"github.com/jitsucom/jitsu/server/drivers/base"
	"github.com/jitsucom/jitsu/server/errorj"
	"github.com/jitsucom/jitsu/server/uuid"
	"strings"

	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/typing"
	_ "github.com/lib/pq"
)

const (
	copyTemplate = `copy "%s"."%s"
					from 's3://%s/%s'
    				ACCESS_KEY_ID '%s'
    				SECRET_ACCESS_KEY '%s'
    				region '%s'
    				json 'auto'
                    dateformat 'auto'
                    timeformat 'auto'`

	deleteBeforeBulkMergeUsing     = `DELETE FROM "%s"."%s" using "%s"."%s" where %s`
	deleteBeforeBulkMergeCondition = `"%s"."%s".%s = "%s"."%s".%s`
	redshiftBulkMergeInsert        = `INSERT INTO "%s"."%s" (%s) select %s from "%s"."%s"`

	primaryKeyFieldsRedshiftQuery = `select tco.constraint_name as constraint_name, kcu.column_name as key_column
									 from information_schema.table_constraints tco
         							   join information_schema.key_column_usage kcu
             						   on kcu.constraint_name = tco.constraint_name
                                          and kcu.constraint_schema = tco.constraint_schema
 										  and kcu.constraint_name = tco.constraint_name
				                     where tco.table_schema = $1 and tco.table_name = $2 and tco.constraint_type = 'PRIMARY KEY'
                                     order by kcu.ordinal_position`

	RedshiftValuesLimit = 32767 // this is a limitation of parameters one can pass as query values. If more parameters are passed, error is returned
	credentialsMask     = "*****"
)

var (
	SchemaToRedshift = map[typing.DataType]string{
		typing.STRING:    "character varying(65535)",
		typing.INT64:     "bigint",
		typing.FLOAT64:   "double precision",
		typing.TIMESTAMP: "timestamp",
		typing.BOOL:      "boolean",
		typing.UNKNOWN:   "character varying(65535)",
	}
)

//AwsRedshift adapter for creating,patching (schema or table), inserting and copying data from s3 to redshift
type AwsRedshift struct {
	//Aws Redshift uses Postgres fork under the hood
	dataSourceProxy *Postgres
	s3Config        *S3Config
}

//NewAwsRedshift returns configured AwsRedshift adapter instance
func NewAwsRedshift(ctx context.Context, dsConfig *DataSourceConfig, s3Config *S3Config,
	queryLogger *logging.QueryLogger, sqlTypes typing.SQLTypes) (*AwsRedshift, error) {

	postgres, err := NewPostgresUnderRedshift(ctx, dsConfig, queryLogger, reformatMappings(sqlTypes, SchemaToRedshift))
	if err != nil {
		return nil, err
	}

	return &AwsRedshift{dataSourceProxy: postgres, s3Config: s3Config}, nil
}

func (AwsRedshift) Type() string {
	return "Redshift"
}

//OpenTx open underline sql transaction and return wrapped instance
func (ar *AwsRedshift) OpenTx() (*Transaction, error) {
	tx, err := ar.dataSourceProxy.dataSource.BeginTx(ar.dataSourceProxy.ctx, nil)
	if err != nil {
		err = checkErr(err)
		return nil, errorj.BeginTransactionError.Wrap(err, "failed to begin transaction").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Schema: ar.dataSourceProxy.config.Schema,
			})
	}

	return &Transaction{tx: tx, dbType: ar.Type()}, nil
}

//Copy transfer data from s3 to redshift by passing COPY request to redshift
func (ar *AwsRedshift) Copy(fileKey, tableName string) error {
	//add folder prefix if configured
	if ar.s3Config.Folder != "" {
		fileKey = ar.s3Config.Folder + "/" + fileKey
	}

	statement := fmt.Sprintf(copyTemplate, ar.dataSourceProxy.config.Schema, tableName, ar.s3Config.Bucket, fileKey, ar.s3Config.AccessKeyID, ar.s3Config.SecretKey, ar.s3Config.Region)
	if _, err := ar.dataSourceProxy.dataSource.ExecContext(ar.dataSourceProxy.ctx, statement); err != nil {
		return errorj.CopyError.Wrap(err, "failed to copy data from s3").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Schema:    ar.dataSourceProxy.config.Schema,
				Table:     tableName,
				Statement: fmt.Sprintf(copyTemplate, ar.dataSourceProxy.config.Schema, tableName, ar.s3Config.Bucket, fileKey, credentialsMask, credentialsMask, ar.s3Config.Region),
			})
	}

	return nil
}

//CreateDbSchema create database schema instance if doesn't exist
func (ar *AwsRedshift) CreateDbSchema(dbSchemaName string) error {
	query := fmt.Sprintf(createDbSchemaIfNotExistsTemplate, dbSchemaName)
	ar.dataSourceProxy.queryLogger.LogDDL(query)

	if _, err := ar.dataSourceProxy.dataSource.ExecContext(ar.dataSourceProxy.ctx, query); err != nil {
		err = checkErr(err)

		return errorj.CreateSchemaError.Wrap(err, "failed to create db schema").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Schema:    dbSchemaName,
				Statement: query,
			})
	}

	return nil
}

//Insert inserts data with InsertContext as a single object or a batch into Redshift
func (ar *AwsRedshift) Insert(insertContext *InsertContext) error {
	if insertContext.eventContext != nil {
		return ar.insertSingle(insertContext.eventContext)
	} else {
		return ar.insertBatch(insertContext.table, insertContext.objects, insertContext.deleteConditions)
	}
}

//insertBatch inserts batch of data in transaction
func (ar *AwsRedshift) insertBatch(table *Table, objects []map[string]interface{}, deleteConditions *base.DeleteConditions) (err error) {
	wrappedTx, err := ar.OpenTx()
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

	if !deleteConditions.IsEmpty() {
		if err = ar.deleteWithConditions(wrappedTx, table, deleteConditions); err != nil {
			return err
		}
	}

	if len(table.PKFields) == 0 {
		return ar.dataSourceProxy.bulkInsertInTransaction(wrappedTx, table, objects, RedshiftValuesLimit)
	}

	//deduplication for bulkMerge success (it fails if there is any duplicate)
	deduplicatedObjectsBuckets := deduplicateObjects(table, objects)

	for _, objectsBucket := range deduplicatedObjectsBuckets {
		if err = ar.bulkMergeInTransaction(wrappedTx, table, objectsBucket); err != nil {
			return err
		}
	}

	return nil
}

//insertSingle inserts single provided object in Redshift with typecasts
func (ar *AwsRedshift) insertSingle(eventContext *EventContext) error {
	_, quotedColumnNames, placeholders, values := ar.dataSourceProxy.buildInsertPayload(eventContext.Table, eventContext.ProcessedEvent)

	statement := fmt.Sprintf(insertTemplate, ar.dataSourceProxy.config.Schema, eventContext.Table.Name, strings.Join(quotedColumnNames, ", "), "("+strings.Join(placeholders, ", ")+")")
	ar.dataSourceProxy.queryLogger.LogQueryWithValues(statement, values)

	if _, err := ar.dataSourceProxy.dataSource.ExecContext(ar.dataSourceProxy.ctx, statement, values...); err != nil {
		err = checkErr(err)

		return errorj.ExecuteInsertError.Wrap(err, "failed to execute single insert").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Schema:      ar.dataSourceProxy.config.Schema,
				Table:       eventContext.Table.Name,
				PrimaryKeys: eventContext.Table.GetPKFields(),
				Statement:   statement,
				Values:      values,
			})

	}

	return nil
}

//PatchTableSchema add new columns/primary keys or delete primary key from existing table
//on primary keys creation error - get table schema, re-create column and try one more time
func (ar *AwsRedshift) PatchTableSchema(patchSchema *Table) error {
	wrappedTx, err := ar.OpenTx()
	if err != nil {
		return err
	}

	patchErr := ar.dataSourceProxy.patchTableSchemaInTransaction(wrappedTx, patchSchema)
	if patchErr == nil {
		return wrappedTx.Commit()
	}

	rbErr := wrappedTx.Rollback()

	msg := patchErr.Error()
	if strings.Contains(strings.ToLower(msg), "can not make a nullable column a primary key") {
		secondWrappedTx, err := ar.OpenTx()
		if err != nil {
			return errorj.Group(patchErr, rbErr, err)
		}

		if err := ar.recreateColumn(secondWrappedTx, patchSchema); err != nil {
			secondWrappedTx.Rollback()
			return errorj.Group(patchErr, rbErr, err)
		}

		if patchRetryErr := ar.dataSourceProxy.patchTableSchemaInTransaction(secondWrappedTx, patchSchema); patchRetryErr != nil {
			secondWrappedTx.Rollback()
			return errorj.Group(patchErr, rbErr, patchRetryErr)
		}

		return secondWrappedTx.Commit()
	} else {
		return errorj.Group(patchErr, rbErr)
	}
}

//GetTableSchema return table (name,columns, primary key) representation wrapped in Table struct
func (ar *AwsRedshift) GetTableSchema(tableName string) (*Table, error) {
	table, err := ar.dataSourceProxy.getTable(tableName)
	if err != nil {
		return nil, err
	}

	//don't select primary keys of non-existent table
	if len(table.Columns) == 0 {
		return table, nil
	}

	primaryKeyName, pkFields, err := ar.getPrimaryKeys(tableName)
	if err != nil {
		return nil, err
	}

	table.PKFields = pkFields
	table.PrimaryKeyName = primaryKeyName

	jitsuPrimaryKeyName := BuildConstraintName(table.Schema, table.Name)
	if primaryKeyName != "" && primaryKeyName != jitsuPrimaryKeyName {
		logging.Warnf("[%s] table: %s.%s has a custom primary key with name: %s that isn't managed by Jitsu. Custom primary key will be used in rows deduplication and updates. primary_key_fields configuration provided in Jitsu config will be ignored.", ar.dataSourceProxy.destinationId(), table.Schema, table.Name, primaryKeyName)
	}
	return table, nil
}

//CreateTable create database table with name,columns provided in Table representation
func (ar *AwsRedshift) CreateTable(tableSchema *Table) error {
	wrappedTx, err := ar.OpenTx()
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

	return ar.dataSourceProxy.createTableInTransaction(wrappedTx, tableSchema)
}

//Update one record in Redshift
func (ar *AwsRedshift) Update(table *Table, object map[string]interface{}, whereKey string, whereValue interface{}) error {
	return ar.dataSourceProxy.Update(table, object, whereKey, whereValue)
}

func (ar *AwsRedshift) getPrimaryKeys(tableName string) (string, map[string]bool, error) {
	primaryKeys := map[string]bool{}
	pkFieldsRows, err := ar.dataSourceProxy.dataSource.QueryContext(ar.dataSourceProxy.ctx, primaryKeyFieldsRedshiftQuery, ar.dataSourceProxy.config.Schema, tableName)
	if err != nil {
		return "", nil, errorj.GetPrimaryKeysError.Wrap(err, "failed to get primary key").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Schema:    ar.dataSourceProxy.config.Schema,
				Table:     tableName,
				Statement: primaryKeyFieldsRedshiftQuery,
				Values:    []interface{}{ar.dataSourceProxy.config.Schema, tableName},
			})
	}

	defer pkFieldsRows.Close()
	var pkFields []string
	var primaryKeyName string
	for pkFieldsRows.Next() {
		var constraintName, fieldName string
		if err := pkFieldsRows.Scan(&constraintName, &fieldName); err != nil {
			return "", nil, errorj.GetPrimaryKeysError.Wrap(err, "failed to scan result").
				WithProperty(errorj.DBInfo, &ErrorPayload{
					Schema:    ar.dataSourceProxy.config.Schema,
					Table:     tableName,
					Statement: primaryKeyFieldsRedshiftQuery,
					Values:    []interface{}{ar.dataSourceProxy.config.Schema, tableName},
				})
		}
		if primaryKeyName == "" && constraintName != "" {
			primaryKeyName = constraintName
		}
		pkFields = append(pkFields, fieldName)
	}
	if err := pkFieldsRows.Err(); err != nil {
		return "", nil, errorj.GetPrimaryKeysError.Wrap(err, "failed read last row").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Schema:    ar.dataSourceProxy.config.Schema,
				Table:     tableName,
				Statement: primaryKeyFieldsRedshiftQuery,
				Values:    []interface{}{ar.dataSourceProxy.config.Schema, tableName},
			})
	}
	for _, field := range pkFields {
		primaryKeys[field] = true
	}

	return primaryKeyName, primaryKeys, nil
}

//recreateNotNullColumn create tmp column -> copy all values -> delete old column -> rename tmp column
func (ar *AwsRedshift) recreateNotNullColumnInTransaction(wrappedTx *Transaction, table *Table) error {
	pkFields := table.GetPKFieldsMap()
	for _, columnName := range table.GetPKFields() {
		column, ok := table.Columns[columnName]
		if !ok {
			continue
		}

		//** create tmp column **
		tmpColumnName := columnName + "_tmp"
		columnDDL := ar.dataSourceProxy.columnDDL(columnName, column, pkFields)
		//replace original name with _tmp one
		columnDDL = strings.ReplaceAll(columnDDL, columnName, tmpColumnName)

		addColumnQuery := fmt.Sprintf(addColumnTemplate, ar.dataSourceProxy.config.Schema, table.Name, columnDDL)
		ar.dataSourceProxy.queryLogger.LogDDL(addColumnQuery)
		if _, err := wrappedTx.tx.ExecContext(ar.dataSourceProxy.ctx, addColumnQuery); err != nil {
			err = checkErr(err)

			return errorj.PatchTableError.Wrap(err, "failed to create tmp column").
				WithProperty(errorj.DBInfo, &ErrorPayload{
					Schema:      ar.dataSourceProxy.config.Schema,
					Table:       table.Name,
					PrimaryKeys: table.GetPKFields(),
					Statement:   addColumnQuery,
				})
		}

		//** copy all values **
		copyColumnQuery := fmt.Sprintf(copyColumnTemplate, ar.dataSourceProxy.config.Schema, table.Name, tmpColumnName, columnName)
		ar.dataSourceProxy.queryLogger.LogDDL(copyColumnQuery)
		if _, err := wrappedTx.tx.ExecContext(ar.dataSourceProxy.ctx, copyColumnQuery); err != nil {
			err = checkErr(err)
			return errorj.PatchTableError.Wrap(err, "failed to copy column data").
				WithProperty(errorj.DBInfo, &ErrorPayload{
					Schema:      ar.dataSourceProxy.config.Schema,
					Table:       table.Name,
					PrimaryKeys: table.GetPKFields(),
					Statement:   copyColumnQuery,
				})
		}

		//** drop old column **
		dropOldColumnQuery := fmt.Sprintf(dropColumnTemplate, ar.dataSourceProxy.config.Schema, table.Name, columnName)
		ar.dataSourceProxy.queryLogger.LogDDL(dropOldColumnQuery)
		if _, err := wrappedTx.tx.ExecContext(ar.dataSourceProxy.ctx, dropOldColumnQuery); err != nil {
			err = checkErr(err)
			return errorj.PatchTableError.Wrap(err, "failed to drop old column").
				WithProperty(errorj.DBInfo, &ErrorPayload{
					Schema:      ar.dataSourceProxy.config.Schema,
					Table:       table.Name,
					PrimaryKeys: table.GetPKFields(),
					Statement:   dropOldColumnQuery,
				})
		}

		//**rename tmp column **
		renameTmpColumnQuery := fmt.Sprintf(renameColumnTemplate, ar.dataSourceProxy.config.Schema, table.Name, tmpColumnName, columnName)
		ar.dataSourceProxy.queryLogger.LogDDL(renameTmpColumnQuery)
		if _, err := wrappedTx.tx.ExecContext(ar.dataSourceProxy.ctx, renameTmpColumnQuery); err != nil {
			err = checkErr(err)
			return errorj.PatchTableError.Wrap(err, "failed to rename tmp column").
				WithProperty(errorj.DBInfo, &ErrorPayload{
					Schema:      ar.dataSourceProxy.config.Schema,
					Table:       table.Name,
					PrimaryKeys: table.GetPKFields(),
					Statement:   renameTmpColumnQuery,
				})
		}
	}

	return nil
}

//Truncate deletes all records in tableName table
func (ar *AwsRedshift) Truncate(tableName string) error {
	return ar.dataSourceProxy.Truncate(tableName)
}

//DropTable drops table in transaction uses underlying postgres datasource
func (ar *AwsRedshift) DropTable(table *Table) error {
	return ar.dataSourceProxy.DropTable(table)
}

func (ar *AwsRedshift) ReplaceTable(originalTable, replacementTable string) (err error) {
	return ar.dataSourceProxy.ReplaceTable(originalTable, replacementTable)
}

//bulkMergeInTransaction uses temporary table and insert from select statement
func (ar *AwsRedshift) bulkMergeInTransaction(wrappedTx *Transaction, table *Table, objects []map[string]interface{}) error {
	tmpTable := &Table{
		Name:           fmt.Sprintf("jitsu_tmp_%s", uuid.NewLettersNumbers()[:5]),
		Columns:        table.Columns,
		PKFields:       map[string]bool{},
		DeletePkFields: false,
	}

	err := ar.dataSourceProxy.createTableInTransaction(wrappedTx, tmpTable)
	if err != nil {
		return errorj.Decorate(err, "failed to create temporary table")
	}

	err = ar.dataSourceProxy.bulkInsertInTransaction(wrappedTx, tmpTable, objects, RedshiftValuesLimit)
	if err != nil {
		return errorj.Decorate(err, "failed to insert into temporary table")
	}

	//delete duplicates from table
	var deleteCondition string
	for i, pkColumn := range table.GetPKFields() {
		if i > 0 {
			deleteCondition += " AND "
		}
		deleteCondition += fmt.Sprintf(deleteBeforeBulkMergeCondition, ar.dataSourceProxy.config.Schema, table.Name, pkColumn, ar.dataSourceProxy.config.Schema, tmpTable.Name, pkColumn)
	}
	deleteStatement := fmt.Sprintf(deleteBeforeBulkMergeUsing, ar.dataSourceProxy.config.Schema, table.Name, ar.dataSourceProxy.config.Schema, tmpTable.Name, deleteCondition)

	ar.dataSourceProxy.queryLogger.LogQuery(deleteStatement)
	if _, err = wrappedTx.tx.ExecContext(ar.dataSourceProxy.ctx, deleteStatement); err != nil {
		err = checkErr(err)

		return errorj.BulkMergeError.Wrap(err, "failed to delete duplicated rows").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Schema:      ar.dataSourceProxy.config.Schema,
				Table:       table.Name,
				PrimaryKeys: table.GetPKFields(),
				Statement:   deleteStatement,
			})
	}

	//insert from select
	var quotedColumnNames []string
	for _, columnName := range tmpTable.SortedColumnNames() {
		quotedColumnNames = append(quotedColumnNames, fmt.Sprintf(`"%s"`, columnName))
	}
	quotedHeader := strings.Join(quotedColumnNames, ", ")
	insertFromSelectStatement := fmt.Sprintf(redshiftBulkMergeInsert, ar.dataSourceProxy.config.Schema, table.Name, quotedHeader, quotedHeader, ar.dataSourceProxy.config.Schema, tmpTable.Name)
	ar.dataSourceProxy.queryLogger.LogQuery(insertFromSelectStatement)
	if _, err = wrappedTx.tx.ExecContext(ar.dataSourceProxy.ctx, insertFromSelectStatement); err != nil {
		err = checkErr(err)

		return errorj.BulkMergeError.Wrap(err, "failed to merge rows").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Schema:      ar.dataSourceProxy.config.Schema,
				Table:       table.Name,
				PrimaryKeys: table.GetPKFields(),
				Statement:   insertFromSelectStatement,
			})
	}

	//delete tmp table
	if err := ar.dataSourceProxy.dropTableInTransaction(wrappedTx, tmpTable, false); err != nil {
		return errorj.Decorate(err, "failed to drop temporary table")
	}

	return nil
}

func (ar *AwsRedshift) deleteWithConditions(wrappedTx *Transaction, table *Table, deleteConditions *base.DeleteConditions) error {
	return ar.dataSourceProxy.deleteInTransaction(wrappedTx, table, deleteConditions)
}

//recreateColumn recreates column with non null condition for primary key
func (ar *AwsRedshift) recreateColumn(wrappedTx *Transaction, patchSchema *Table) error {
	//get table schema, re-create field and set it not null in a new transaction
	table, err := ar.GetTableSchema(patchSchema.Name)
	if err != nil {
		return err
	}

	table.PKFields = patchSchema.PKFields

	if err := ar.recreateNotNullColumnInTransaction(wrappedTx, table); err != nil {
		return err
	}

	return nil
}

//Close underlying sql.DB
func (ar *AwsRedshift) Close() error {
	return ar.dataSourceProxy.Close()
}
