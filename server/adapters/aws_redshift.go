package adapters

import (
	"context"
	"fmt"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/typing"
	_ "github.com/lib/pq"
	"strconv"
	"strings"
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

	updateStatement = `UPDATE "%s"."%s" SET %s WHERE %s=$%d`

	primaryKeyFieldsRedshiftQuery = `select kcu.column_name as key_column
									 from information_schema.table_constraints tco
         							   join information_schema.key_column_usage kcu
             						   on kcu.constraint_name = tco.constraint_name
                                          and kcu.constraint_schema = tco.constraint_schema
 										  and kcu.constraint_name = tco.constraint_name
				                     where tco.table_schema = $1 and tco.table_name = $2 and tco.constraint_type = 'PRIMARY KEY'
                                     order by kcu.ordinal_position`
)

var (
	SchemaToRedshift = map[typing.DataType]string{
		typing.STRING:    "character varying(65535)",
		typing.INT64:     "bigint",
		typing.FLOAT64:   "numeric(38,18)",
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

//NewAwsRedshift return configured AwsRedshift adapter instance
func NewAwsRedshift(ctx context.Context, dsConfig *DataSourceConfig, s3Config *S3Config,
	queryLogger *logging.QueryLogger, mappingTypeCasts map[string]string) (*AwsRedshift, error) {

	postgres, err := NewPostgresUnderRedshift(ctx, dsConfig, queryLogger, reformatMappings(mappingTypeCasts, SchemaToRedshift))
	if err != nil {
		return nil, err
	}

	return &AwsRedshift{dataSourceProxy: postgres, s3Config: s3Config}, nil
}

func (AwsRedshift) Name() string {
	return "Redshift"
}

//OpenTx open underline sql transaction and return wrapped instance
func (ar *AwsRedshift) OpenTx() (*Transaction, error) {
	tx, err := ar.dataSourceProxy.dataSource.BeginTx(ar.dataSourceProxy.ctx, nil)
	if err != nil {
		return nil, err
	}

	return &Transaction{tx: tx, dbType: ar.Name()}, nil
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
		wrappedTx.Rollback()
		return err
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
func (ar *AwsRedshift) Insert(table *Table, valuesMap map[string]interface{}) error {
	header, placeholders, values := ar.dataSourceProxy.buildQueryPayload(valuesMap)

	query := fmt.Sprintf(insertTemplate, ar.dataSourceProxy.config.Schema, table.Name, header, "("+placeholders+")")

	ar.dataSourceProxy.queryLogger.LogQueryWithValues(query, values)
	_, err := ar.dataSourceProxy.dataSource.ExecContext(ar.dataSourceProxy.ctx, query, values...)
	if err != nil {
		return fmt.Errorf("Error inserting in %s table with statement: %s values: %v: %v", table.Name, query, values, err)
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
				secondWrappedTx.Rollback()
				return fmt.Errorf("%v (re-creation failed: %v)", patchErr, err)
			}

			table.PKFields = patchSchema.PKFields

			recreationErr := ar.recreateNotNullColumnInTransaction(secondWrappedTx, table)
			if recreationErr != nil {
				secondWrappedTx.Rollback()
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

	pkFields, err := ar.getPrimaryKeys(tableName)
	if err != nil {
		return nil, err
	}

	table.PKFields = pkFields
	return table, nil
}

//CreateTable create database table with name,columns provided in Table representation
func (ar *AwsRedshift) CreateTable(tableSchema *Table) error {
	wrappedTx, err := ar.OpenTx()
	if err != nil {
		return err
	}

	return ar.dataSourceProxy.createTableInTransaction(wrappedTx, tableSchema)
}

//Update one record in Redshift
func (ar *AwsRedshift) Update(table *Table, object map[string]interface{}, whereKey string, whereValue interface{}) error {
	columns := make([]string, len(object), len(object))
	values := make([]interface{}, len(object)+1, len(object)+1)
	i := 0
	for name, value := range object {
		columns[i] = name + "= $" + strconv.Itoa(i+1) //$0 - wrong
		values[i] = value
		i++
	}
	values[i] = whereValue

	statement := fmt.Sprintf(updateStatement, ar.dataSourceProxy.config.Schema, table.Name, strings.Join(columns, ", "), whereKey, i+1)
	ar.dataSourceProxy.queryLogger.LogQueryWithValues(statement, values)
	_, err := ar.dataSourceProxy.dataSource.ExecContext(ar.dataSourceProxy.ctx, statement, values...)
	if err != nil {
		return fmt.Errorf("Error updating %s table with statement: %s values: %v: %v", table.Name, statement, values, err)
	}

	return nil
}

func (ar *AwsRedshift) getPrimaryKeys(tableName string) (map[string]bool, error) {
	primaryKeys := map[string]bool{}
	pkFieldsRows, err := ar.dataSourceProxy.dataSource.QueryContext(ar.dataSourceProxy.ctx, primaryKeyFieldsRedshiftQuery, ar.dataSourceProxy.config.Schema, tableName)
	if err != nil {
		return nil, fmt.Errorf("Error querying primary keys for [%s.%s] table: %v", ar.dataSourceProxy.config.Schema, tableName, err)
	}

	defer pkFieldsRows.Close()
	var pkFields []string
	for pkFieldsRows.Next() {
		var fieldName string
		if err := pkFieldsRows.Scan(&fieldName); err != nil {
			return nil, fmt.Errorf("Error scanning primary key result: %v", err)
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
			return fmt.Errorf("Error creating [%s] tmp column %s table with [%s] DDL: %v", tmpColumnName, table.Name, columnDDL, err)
		}

		//** copy all values **
		copyColumnQuery := fmt.Sprintf(copyColumnTemplate, ar.dataSourceProxy.config.Schema, table.Name, tmpColumnName, columnName)
		ar.dataSourceProxy.queryLogger.LogDDL(copyColumnQuery)
		_, err = wrappedTx.tx.ExecContext(ar.dataSourceProxy.ctx, copyColumnQuery)
		if err != nil {
			return fmt.Errorf("Error copying column [%s] into tmp column [%s]: %v", columnName, tmpColumnName, err)
		}

		//** drop old column **
		dropOldColumnQuery := fmt.Sprintf(dropColumnTemplate, ar.dataSourceProxy.config.Schema, table.Name, columnName)
		ar.dataSourceProxy.queryLogger.LogDDL(dropOldColumnQuery)
		_, err = wrappedTx.tx.ExecContext(ar.dataSourceProxy.ctx, dropOldColumnQuery)
		if err != nil {
			return fmt.Errorf("Error droping old column [%s]: %v", columnName, err)
		}

		//**rename tmp column **
		renameTmpColumnQuery := fmt.Sprintf(renameColumnTemplate, ar.dataSourceProxy.config.Schema, table.Name, tmpColumnName, columnName)
		ar.dataSourceProxy.queryLogger.LogDDL(renameTmpColumnQuery)
		_, err = wrappedTx.tx.ExecContext(ar.dataSourceProxy.ctx, renameTmpColumnQuery)
		if err != nil {
			return fmt.Errorf("Error renaming tmp column [%s] to [%s]: %v", tmpColumnName, columnName, err)
		}
	}

	return nil
}

//Close underlying sql.DB
func (ar *AwsRedshift) Close() error {
	return ar.dataSourceProxy.Close()
}
