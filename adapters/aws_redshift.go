package adapters

import (
	"context"
	"fmt"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/typing"
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
func (ar *AwsRedshift) Insert(schema *Table, valuesMap map[string]interface{}) error {
	return ar.dataSourceProxy.Insert(schema, valuesMap)
}

//PatchTableSchema add new columns/primary keys or delete primary key to existing table
func (ar *AwsRedshift) PatchTableSchema(patchSchema *Table) error {
	wrappedTx, err := ar.OpenTx()
	if err != nil {
		return err
	}

	return ar.dataSourceProxy.patchTableSchemaInTransaction(wrappedTx, patchSchema)
}

//GetTableSchema return table (name,columns, primary key) representation wrapped in Table struct
func (ar *AwsRedshift) GetTableSchema(tableName string) (*Table, error) {
	return ar.dataSourceProxy.getTable(tableName)
}

//CreateTable create database table with name,columns provided in Table representation
func (ar *AwsRedshift) CreateTable(tableSchema *Table) error {
	wrappedTx, err := ar.OpenTx()
	if err != nil {
		return err
	}

	return ar.dataSourceProxy.createTableInTransaction(wrappedTx, tableSchema)
}

//Close underlying sql.DB
func (ar *AwsRedshift) Close() error {
	return ar.dataSourceProxy.Close()
}
