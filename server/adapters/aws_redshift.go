package adapters

import (
	"context"
	"fmt"
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

	redshiftValuesLimit = 32767 // this is a limitation of parameters one can pass as query values. If more parameters are passed, error is returned
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
		return nil, err
	}

	return &Transaction{tx: tx, dbType: ar.Type()}, nil
}

//Copy transfer data from s3 to redshift by passing COPY request to redshift
func (ar *AwsRedshift) Copy(fileKey, tableName string) error {
	wrappedTx, err := ar.OpenTx()
	if err != nil {
		return err
	}

	//add folder prefix if configured
	if ar.s3Config.Folder != "" {
		fileKey = ar.s3Config.Folder + "/" + fileKey
	}

	statement := fmt.Sprintf(copyTemplate, ar.dataSourceProxy.config.Schema, tableName, ar.s3Config.Bucket, fileKey, ar.s3Config.AccessKeyID, ar.s3Config.SecretKey, ar.s3Config.Region)
	_, err = wrappedTx.tx.ExecContext(ar.dataSourceProxy.ctx, statement)
	if err != nil {
		wrappedTx.Rollback(err)
		return checkErr(err)
	}

	return wrappedTx.DirectCommit()
}

//CreateDbSchema create database schema instance if doesn't exist
func (ar *AwsRedshift) CreateDbSchema(dbSchemaName string) error {
	wrappedTx, err := ar.OpenTx()
	if err != nil {
		return err
	}

	return createDbSchemaInTransaction(ar.dataSourceProxy.ctx, wrappedTx, createDbSchemaIfNotExistsTemplate, dbSchemaName,
		ar.dataSourceProxy.queryLogger)
}

//Insert provided object in AwsRedshift
func (ar *AwsRedshift) Insert(eventContext *EventContext) error {
	_, quotedColumnNames, placeholders, values := ar.dataSourceProxy.buildInsertPayload(eventContext.Table, eventContext.ProcessedEvent)

	statement := fmt.Sprintf(insertTemplate, ar.dataSourceProxy.config.Schema, eventContext.Table.Name, strings.Join(quotedColumnNames, ", "), "("+strings.Join(placeholders, ", ")+")")
	ar.dataSourceProxy.queryLogger.LogQueryWithValues(statement, values)

	_, err := ar.dataSourceProxy.dataSource.ExecContext(ar.dataSourceProxy.ctx, statement, values...)
	if err != nil {
		err = checkErr(err)
		return fmt.Errorf("Error inserting in %s table with statement: %s values: %v: %v", eventContext.Table.Name, statement, values, err)
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
	if patchErr != nil {
		msg := patchErr.Error()
		if strings.Contains(strings.ToLower(msg), "can not make a nullable column a primary key") {
			//get table schema, re-create field and set it not null in a new transaction
			secondWrappedTx, txErr := ar.OpenTx()
			if txErr != nil {
				return fmt.Errorf("%v (re-creation failed: %v)", patchErr, txErr)
			}

			table, err := ar.GetTableSchema(patchSchema.Name)
			if err != nil {
				secondWrappedTx.Rollback(err)
				return fmt.Errorf("%v (re-creation failed: %v)", patchErr, err)
			}

			table.PKFields = patchSchema.PKFields

			recreationErr := ar.recreateNotNullColumnInTransaction(secondWrappedTx, table)
			if recreationErr != nil {
				secondWrappedTx.Rollback(recreationErr)
				return fmt.Errorf("%v (re-creation failed: %v)", patchErr, recreationErr)
			}

			if patchRetryErr := ar.dataSourceProxy.patchTableSchemaInTransaction(secondWrappedTx, patchSchema); patchRetryErr != nil {
				return patchRetryErr
			}

			return nil
		} else {
			return patchErr
		}
	}

	return nil
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

	err = ar.dataSourceProxy.createTableInTransaction(wrappedTx, tableSchema)
	if err != nil {
		wrappedTx.Rollback(err)
		return err
	}

	return wrappedTx.DirectCommit()
}

//Update one record in Redshift
func (ar *AwsRedshift) Update(table *Table, object map[string]interface{}, whereKey string, whereValue interface{}) error {
	return ar.dataSourceProxy.Update(table, object, whereKey, whereValue)
}

func (ar *AwsRedshift) getPrimaryKeys(tableName string) (string, map[string]bool, error) {
	primaryKeys := map[string]bool{}
	pkFieldsRows, err := ar.dataSourceProxy.dataSource.QueryContext(ar.dataSourceProxy.ctx, primaryKeyFieldsRedshiftQuery, ar.dataSourceProxy.config.Schema, tableName)
	if err != nil {
		return "", nil, fmt.Errorf("Error querying primary keys for [%s.%s] table: %v", ar.dataSourceProxy.config.Schema, tableName, err)
	}

	defer pkFieldsRows.Close()
	var pkFields []string
	var primaryKeyName string
	for pkFieldsRows.Next() {
		var constraintName, fieldName string
		if err := pkFieldsRows.Scan(&constraintName, &fieldName); err != nil {
			return "", nil, fmt.Errorf("Error scanning primary key result: %v", err)
		}
		if primaryKeyName == "" && constraintName != "" {
			primaryKeyName = constraintName
		}
		pkFields = append(pkFields, fieldName)
	}
	if err := pkFieldsRows.Err(); err != nil {
		return "", nil, fmt.Errorf("pk last rows.Err: %v", err)
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
		_, err := wrappedTx.tx.ExecContext(ar.dataSourceProxy.ctx, addColumnQuery)
		if err != nil {
			err = checkErr(err)
			return fmt.Errorf("Error creating [%s] tmp column %s table with [%s] DDL: %v", tmpColumnName, table.Name, columnDDL, err)
		}

		//** copy all values **
		copyColumnQuery := fmt.Sprintf(copyColumnTemplate, ar.dataSourceProxy.config.Schema, table.Name, tmpColumnName, columnName)
		ar.dataSourceProxy.queryLogger.LogDDL(copyColumnQuery)
		_, err = wrappedTx.tx.ExecContext(ar.dataSourceProxy.ctx, copyColumnQuery)
		if err != nil {
			err = checkErr(err)
			return fmt.Errorf("Error copying column [%s] into tmp column [%s]: %v", columnName, tmpColumnName, err)
		}

		//** drop old column **
		dropOldColumnQuery := fmt.Sprintf(dropColumnTemplate, ar.dataSourceProxy.config.Schema, table.Name, columnName)
		ar.dataSourceProxy.queryLogger.LogDDL(dropOldColumnQuery)
		_, err = wrappedTx.tx.ExecContext(ar.dataSourceProxy.ctx, dropOldColumnQuery)
		if err != nil {
			err = checkErr(err)
			return fmt.Errorf("Error droping old column [%s]: %v", columnName, err)
		}

		//**rename tmp column **
		renameTmpColumnQuery := fmt.Sprintf(renameColumnTemplate, ar.dataSourceProxy.config.Schema, table.Name, tmpColumnName, columnName)
		ar.dataSourceProxy.queryLogger.LogDDL(renameTmpColumnQuery)
		_, err = wrappedTx.tx.ExecContext(ar.dataSourceProxy.ctx, renameTmpColumnQuery)
		if err != nil {
			err = checkErr(err)
			return fmt.Errorf("Error renaming tmp column [%s] to [%s]: %v", tmpColumnName, columnName, err)
		}
	}

	return nil
}

//BulkInsert opens a new transaction and uses bulkStoreInTransaction func
func (ar *AwsRedshift) BulkInsert(table *Table, objects []map[string]interface{}) error {
	wrappedTx, err := ar.OpenTx()
	if err != nil {
		return err
	}

	if err = ar.bulkStoreInTransaction(wrappedTx, table, objects); err != nil {
		wrappedTx.Rollback(err)
		return err
	}

	return wrappedTx.DirectCommit()
}

//BulkUpdate deletes with deleteConditions and runs bulkStoreInTransaction
func (ar *AwsRedshift) BulkUpdate(table *Table, objects []map[string]interface{}, deleteConditions *DeleteConditions) error {
	wrappedTx, err := ar.OpenTx()
	if err != nil {
		return err
	}

	if !deleteConditions.IsEmpty() {
		if err := ar.deleteWithConditions(wrappedTx, table, deleteConditions); err != nil {
			wrappedTx.Rollback(err)
			return err
		}
	}

	if err := ar.bulkStoreInTransaction(wrappedTx, table, objects); err != nil {
		wrappedTx.Rollback(err)
		return err
	}

	return wrappedTx.DirectCommit()
}

//Truncate deletes all records in tableName table
func (ar *AwsRedshift) Truncate(tableName string) error {
	return ar.dataSourceProxy.Truncate(tableName)
}

//DropTable drops table in transaction uses underlying postgres datasource
func (ar *AwsRedshift) DropTable(table *Table) error {
	return ar.dataSourceProxy.DropTable(table)
}

//bulkStoreInTransaction uses different statements for inserts and merges. Without primary keys:
//  inserts data batch into the table by using postgres bulk insert (insert into ... values (), (), ())
//with primary keys:
//  uses bulkMergeInTransaction func with deduplicated objects
func (ar *AwsRedshift) bulkStoreInTransaction(wrappedTx *Transaction, table *Table, objects []map[string]interface{}) error {
	if len(table.PKFields) == 0 {
		return ar.dataSourceProxy.bulkInsertInTransaction(wrappedTx, table, objects, redshiftValuesLimit)
	}

	//deduplication for bulkMerge success (it fails if there is any duplicate)
	deduplicatedObjectsBuckets := deduplicateObjects(table, objects)

	for _, objectsBucket := range deduplicatedObjectsBuckets {
		if err := ar.bulkMergeInTransaction(wrappedTx, table, objectsBucket); err != nil {
			return err
		}
	}

	return nil
}

//bulkMergeInTransaction uses temporary table and insert from select statement
func (ar *AwsRedshift) bulkMergeInTransaction(wrappedTx *Transaction, table *Table, objects []map[string]interface{}) error {
	tmpTable := &Table{
		Name:           fmt.Sprintf("jitsu_tmp_%s", uuid.NewLettersNumbers()[:5]),
		Columns:        table.Columns,
		PKFields:       map[string]bool{},
		DeletePkFields: false,
		Version:        0,
	}

	err := ar.dataSourceProxy.createTableInTransaction(wrappedTx, tmpTable)
	if err != nil {
		return fmt.Errorf("Error creating temporary table: %v", err)
	}

	err = ar.dataSourceProxy.bulkInsertInTransaction(wrappedTx, tmpTable, objects, redshiftValuesLimit)
	if err != nil {
		return fmt.Errorf("Error inserting in temporary table [%s]: %v", tmpTable.Name, err)
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
	_, err = wrappedTx.tx.ExecContext(ar.dataSourceProxy.ctx, deleteStatement)
	if err != nil {
		err = checkErr(err)
		return fmt.Errorf("Error deleting duplicated rows: %v", err)
	}

	//insert from select
	var quotedColumnNames []string
	for columnName := range tmpTable.Columns {
		quotedColumnNames = append(quotedColumnNames, fmt.Sprintf(`"%s"`, columnName))
	}
	quotedHeader := strings.Join(quotedColumnNames, ", ")
	insertFromSelectStatement := fmt.Sprintf(redshiftBulkMergeInsert, ar.dataSourceProxy.config.Schema, table.Name, quotedHeader, quotedHeader, ar.dataSourceProxy.config.Schema, tmpTable.Name)
	ar.dataSourceProxy.queryLogger.LogQuery(insertFromSelectStatement)
	_, err = wrappedTx.tx.ExecContext(ar.dataSourceProxy.ctx, insertFromSelectStatement)
	if err != nil {
		err = checkErr(err)
		return fmt.Errorf("Error merging rows: %v", err)
	}

	//delete tmp table
	return ar.dataSourceProxy.dropTableInTransaction(wrappedTx, tmpTable)
}

func (ar *AwsRedshift) deleteWithConditions(wrappedTx *Transaction, table *Table, deleteConditions *DeleteConditions) error {
	return ar.dataSourceProxy.deleteInTransaction(wrappedTx, table, deleteConditions)
}

//Close underlying sql.DB
func (ar *AwsRedshift) Close() error {
	return ar.dataSourceProxy.Close()
}
