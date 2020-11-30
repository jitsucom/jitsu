package adapters

import (
	"context"
	"fmt"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/schema"
	"github.com/jitsucom/eventnative/typing"
	_ "github.com/lib/pq"
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
)

//AwsRedshift adapter for creating,patching (schema or table), copying data from s3 to redshift
type AwsRedshift struct {
	//Aws Redshift uses Postgres fork under the hood
	dataSourceProxy *Postgres
	s3Config        *S3Config
}

//NewAwsRedshift return configured AwsRedshift adapter instance
func NewAwsRedshift(ctx context.Context, dsConfig *DataSourceConfig, s3Config *S3Config,
	queryLogger *logging.QueryLogger) (*AwsRedshift, error) {
	postgres, err := NewPostgres(ctx, dsConfig, queryLogger)
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

//Copy transfer data from s3 to redshift by passing COPY request to redshift in provided wrapped transaction
func (ar *AwsRedshift) Copy(wrappedTx *Transaction, fileKey, tableName string) error {
	statement := fmt.Sprintf(copyTemplate, ar.dataSourceProxy.config.Schema, tableName, ar.s3Config.Bucket, fileKey, ar.s3Config.AccessKeyID, ar.s3Config.SecretKey, ar.s3Config.Region)
	_, err := wrappedTx.tx.ExecContext(ar.dataSourceProxy.ctx, statement)

	return err
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

//Insert provided object in AwsRedshift in stream mode
func (ar *AwsRedshift) Insert(schema *schema.Table, valuesMap map[string]interface{}) error {
	wrappedTx, err := ar.OpenTx()
	if err != nil {
		return err
	}

	if err := ar.dataSourceProxy.InsertInTransaction(wrappedTx, schema, valuesMap); err != nil {
		wrappedTx.Rollback()
		return err
	}

	return wrappedTx.DirectCommit()
}

//PatchTableSchema add new columns(from provided schema.Table) to existing table
func (ar *AwsRedshift) PatchTableSchema(patchSchema *schema.Table) error {
	wrappedTx, err := ar.OpenTx()
	if err != nil {
		return err
	}

	return ar.dataSourceProxy.patchTableSchemaInTransaction(wrappedTx, patchSchema)
}

//GetTableSchema return table (name,columns with name and types) representation wrapped in schema.Table struct
func (ar *AwsRedshift) GetTableSchema(tableName string) (*schema.Table, error) {
	p := ar.dataSourceProxy
	table := &schema.Table{Name: tableName, Columns: schema.Columns{}}
	rows, err := p.dataSource.QueryContext(p.ctx, tableSchemaQuery, p.config.Schema, tableName)
	if err != nil {
		return nil, fmt.Errorf("Error querying table [%s] schema: %v", tableName, err)
	}

	defer rows.Close()
	for rows.Next() {
		var columnName, columnPostgresType string
		if err := rows.Scan(&columnName, &columnPostgresType); err != nil {
			return nil, fmt.Errorf("Error scanning result: %v", err)
		}
		mappedType, ok := PostgresToSchema[strings.ToLower(columnPostgresType)]
		if !ok {
			if columnPostgresType == "-" {
				//skip dropped postgres field
				continue
			}
			logging.Errorf("Unknown postgres [%s] column type: %s in schema: [%s] table: [%s]", columnName, columnPostgresType, p.config.Schema, tableName)

			mappedType = typing.STRING
		}
		table.Columns[columnName] = schema.NewColumn(mappedType)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("Last rows.Err: %v", err)
	}
	return table, nil
}

//CreateTable create database table with name,columns provided in schema.Table representation
func (ar *AwsRedshift) CreateTable(tableSchema *schema.Table) error {
	wrappedTx, err := ar.OpenTx()
	if err != nil {
		return err
	}

	return ar.dataSourceProxy.createTableInTransaction(wrappedTx, tableSchema)
}

func (ar *AwsRedshift) UpdatePrimaryKey(patchTableSchema *schema.Table, patchConstraint *schema.PKFieldsPatch) error {
	logging.Warn("Constraints update is not supported for Redshift yet")
	return nil
}

//Close underlying sql.DB
func (ar *AwsRedshift) Close() error {
	return ar.dataSourceProxy.Close()
}
