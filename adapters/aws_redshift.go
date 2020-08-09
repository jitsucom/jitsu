package adapters

import (
	"context"
	"fmt"
	"github.com/ksensehq/eventnative/schema"
	_ "github.com/lib/pq"
)

const (
	copyTemplate = `copy "%s"."%s"
					from 's3://%s/%s'
    				ACCESS_KEY_ID '%s'
    				SECRET_ACCESS_KEY '%s'
    				region '%s'
    				json 'auto'`
)

type AwsRedshift struct {
	//Aws Redshift has Postgres fork under the hood
	dataSourceProxy *Postgres
	s3Config        *S3Config
}

func NewAwsRedshift(ctx context.Context, dsConfig *DataSourceConfig, s3Config *S3Config) (*AwsRedshift, error) {
	postgres, err := NewPostgres(ctx, dsConfig)
	if err != nil {
		return nil, err
	}

	return &AwsRedshift{dataSourceProxy: postgres, s3Config: s3Config}, nil
}

func (AwsRedshift) Name() string {
	return "Redshift"
}

func (ar *AwsRedshift) OpenTx() (*Transaction, error) {
	tx, err := ar.dataSourceProxy.dataSource.BeginTx(ar.dataSourceProxy.ctx, nil)
	if err != nil {
		return nil, err
	}

	return &Transaction{tx: tx, dbType: ar.Name()}, nil
}

func (ar *AwsRedshift) Copy(wrappedTx *Transaction, fileKey, tableName string) error {
	statement := fmt.Sprintf(copyTemplate, ar.dataSourceProxy.config.Schema, tableName, ar.s3Config.Bucket, fileKey, ar.s3Config.AccessKeyID, ar.s3Config.SecretKey, ar.s3Config.Region)
	_, err := wrappedTx.tx.ExecContext(ar.dataSourceProxy.ctx, statement)

	return err
}

func (ar *AwsRedshift) CreateDbSchema(dbSchemaName string) error {
	return ar.dataSourceProxy.CreateDbSchema(dbSchemaName)
}

func (ar *AwsRedshift) PatchTableSchema(patchSchema *schema.Table) error {
	return ar.dataSourceProxy.PatchTableSchema(patchSchema)
}

func (ar *AwsRedshift) GetTableSchema(tableName string) (*schema.Table, error) {
	return ar.dataSourceProxy.GetTableSchema(tableName)
}

func (ar *AwsRedshift) CreateTable(tableSchema *schema.Table) error {
	return ar.dataSourceProxy.CreateTable(tableSchema)
}

func (ar *AwsRedshift) Close() error {
	return ar.dataSourceProxy.Close()
}
