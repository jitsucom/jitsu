package adapters

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/ksensehq/tracker/schema"
	_ "github.com/lib/pq"
	"log"
	"strings"
)

const (
	connectTimeoutSeconds = 600 //TODO make it configurable

	tableNamesQuery  = `SELECT table_name FROM information_schema.tables WHERE table_schema=$1`
	tableSchemaQuery = `SELECT 
 							pg_attribute.attname AS name,
    						pg_catalog.format_type(pg_attribute.atttypid,pg_attribute.atttypmod) AS column_type
						FROM pg_attribute
         					JOIN pg_class ON pg_class.oid = pg_attribute.attrelid
         					LEFT JOIN pg_attrdef pg_attrdef ON pg_attrdef.adrelid = pg_class.oid AND pg_attrdef.adnum = pg_attribute.attnum
         					LEFT JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
         					LEFT JOIN pg_constraint ON pg_constraint.conrelid = pg_class.oid AND pg_attribute.attnum = ANY (pg_constraint.conkey)
						WHERE pg_class.relkind = 'r'::char
  							AND  pg_namespace.nspname = $1
  							AND pg_class.relname = $2
  							AND pg_attribute.attnum > 0`
	createDbSchemaIfNotExistsTemplate = `CREATE SCHEMA IF NOT EXISTS "%s"`
	addColumnTemplate                 = `ALTER TABLE "%s"."%s" ADD COLUMN %s %s`
	createTableTemplate               = `CREATE TABLE "%s"."%s" (%s)`
	copyTemplate                      = `copy "%s"."%s"
					 					from 's3://%s/%s'
    				 					ACCESS_KEY_ID '%s'
    				 					SECRET_ACCESS_KEY '%s'
    				 					region '%s'
    				 					json 'auto'`
)

var (
	SchemaToRedshift = map[schema.DataType]string{
		//"date":      "date",
		//"timestamp": "timestamp without time zone",
		schema.STRING: "character varying(512)",
	}

	RedshiftToSchema = map[string]schema.DataType{
		"character varying(512)": schema.STRING,
	}
)

type AwsRedshift struct {
	ctx            context.Context
	dataSource     *sql.DB
	redshiftConfig *DataSourceConfig
	s3Config       *S3Config
}

type DataSourceConfig struct {
	Host     string `mapstructure:"host"`
	Port     int    `mapstructure:"port"`
	Db       string `mapstructure:"db"`
	Schema   string `mapstructure:"schema"`
	Username string `mapstructure:"username"`
	Password string `mapstructure:"password"`
}

func (dsc *DataSourceConfig) Validate() error {
	if dsc == nil {
		return errors.New("Datasource config is required")
	}
	if dsc.Host == "" {
		return errors.New("Datasource host is required parameter")
	}
	if dsc.Db == "" {
		return errors.New("Datasource db is required parameter")
	}
	if dsc.Username == "" {
		return errors.New("Datasource username is required parameter")
	}

	return nil
}

func NewAwsRedshift(ctx context.Context, redshiftConfig *DataSourceConfig, s3Config *S3Config) (*AwsRedshift, error) {
	connectionString := fmt.Sprintf("host=%s port=%d dbname=%s connect_timeout=%d",
		redshiftConfig.Host, redshiftConfig.Port, redshiftConfig.Db, connectTimeoutSeconds)
	log.Println("Connecting to Redshift Source:", connectionString)
	connectionString += fmt.Sprintf(" user=%s password=%s", redshiftConfig.Username, redshiftConfig.Password)
	dataSource, err := sql.Open("postgres", connectionString)
	if err != nil {
		return nil, err
	}
	if err := dataSource.Ping(); err != nil {
		return nil, err
	}

	return &AwsRedshift{ctx: ctx, dataSource: dataSource, redshiftConfig: redshiftConfig, s3Config: s3Config}, nil
}

func (ar *AwsRedshift) OpenTx() (*RedshiftTransaction, error) {
	tx, err := ar.dataSource.BeginTx(ar.ctx, nil)
	if err != nil {
		return nil, err
	}

	return &RedshiftTransaction{tx: tx}, nil
}

func (ar *AwsRedshift) Copy(wrappedTx *RedshiftTransaction, fileKey, tableName string) error {
	statement := fmt.Sprintf(copyTemplate, ar.redshiftConfig.Schema, tableName, ar.s3Config.Bucket, fileKey, ar.s3Config.AccessKeyID, ar.s3Config.SecretKey, ar.s3Config.Region)
	_, err := wrappedTx.tx.ExecContext(ar.ctx, statement)

	return err
}

func (ar *AwsRedshift) TablesList() ([]string, error) {
	var tableNames []string
	rows, err := ar.dataSource.QueryContext(ar.ctx, tableNamesQuery, ar.redshiftConfig.Schema)
	if err != nil {
		return tableNames, fmt.Errorf("Error querying tables names: %v", err)
	}

	defer rows.Close()
	for rows.Next() {
		var tableName string
		if err := rows.Scan(&tableName); err != nil {
			return tableNames, fmt.Errorf("Error scanning table name: %v", err)
		}
		tableNames = append(tableNames, tableName)
	}
	if err := rows.Err(); err != nil {
		return tableNames, fmt.Errorf("Last rows.Err: %v", err)
	}

	return tableNames, nil
}

func (ar *AwsRedshift) GetTableSchema(tableName string) (*schema.Table, error) {
	table := &schema.Table{Name: tableName, Columns: schema.Columns{}}
	rows, err := ar.dataSource.QueryContext(ar.ctx, tableSchemaQuery, ar.redshiftConfig.Schema, tableName)
	if err != nil {
		return nil, fmt.Errorf("Error querying table [%s] schema: %v", tableName, err)
	}

	defer rows.Close()
	for rows.Next() {
		var columnName, columnRedshiftType string
		if err := rows.Scan(&columnName, &columnRedshiftType); err != nil {
			return nil, fmt.Errorf("Error scanning result: %v", err)
		}
		mappedType, ok := RedshiftToSchema[columnRedshiftType]
		if !ok {
			log.Println("Unknown redshift column type:", columnRedshiftType)
			mappedType = schema.STRING
		}
		table.Columns[columnName] = schema.Column{Type: mappedType}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("Last rows.Err: %v", err)
	}

	return table, nil
}

func (ar *AwsRedshift) CreateTable(tableSchema *schema.Table) error {
	wrappedTx, err := ar.OpenTx()
	if err != nil {
		return err
	}

	var columnsDDL []string
	for columnName, column := range tableSchema.Columns {
		mappedType, ok := SchemaToRedshift[column.Type]
		if !ok {
			log.Println("Unknown redshift schema type:", column.Type)
			mappedType = SchemaToRedshift[schema.STRING]
		}
		columnsDDL = append(columnsDDL, fmt.Sprintf(`%s %s`, columnName, mappedType))
	}

	createStmt, err := wrappedTx.tx.PrepareContext(ar.ctx, fmt.Sprintf(createTableTemplate, ar.redshiftConfig.Schema, tableSchema.Name, strings.Join(columnsDDL, ",")))
	if err != nil {
		wrappedTx.Rollback()
		return fmt.Errorf("Error preparing create table %s statement %v", tableSchema.Name, err)
	}

	_, err = createStmt.ExecContext(ar.ctx)

	if err != nil {
		wrappedTx.Rollback()
		return fmt.Errorf("Error creating [%s] redshift table %v", tableSchema.Name, err)
	}
	return wrappedTx.tx.Commit()
}

func (ar *AwsRedshift) CreateDbSchema(dbSchemaName string) error {
	wrappedTx, err := ar.OpenTx()
	if err != nil {
		return err
	}

	createStmt, err := wrappedTx.tx.PrepareContext(ar.ctx, fmt.Sprintf(createDbSchemaIfNotExistsTemplate, dbSchemaName))
	if err != nil {
		wrappedTx.Rollback()
		return fmt.Errorf("Error preparing create db schema %s statement %v", dbSchemaName, err)
	}

	_, err = createStmt.ExecContext(ar.ctx)

	if err != nil {
		wrappedTx.Rollback()
		return fmt.Errorf("Error creating [%s] db schema %v", dbSchemaName, err)
	}
	return wrappedTx.tx.Commit()
}

func (ar *AwsRedshift) PatchTableSchema(patchSchema *schema.Table) error {
	wrappedTx, err := ar.OpenTx()
	if err != nil {
		return err
	}

	for columnName, column := range patchSchema.Columns {
		mappedColumnType, ok := SchemaToRedshift[column.Type]
		if !ok {
			log.Println("Unknown redshift schema type:", column.Type.String())
			mappedColumnType = SchemaToRedshift[schema.STRING]
		}
		alterStmt, err := wrappedTx.tx.PrepareContext(ar.ctx, fmt.Sprintf(addColumnTemplate, ar.redshiftConfig.Schema, patchSchema.Name, columnName, mappedColumnType))
		if err != nil {
			wrappedTx.Rollback()
			return fmt.Errorf("Error preparing patching table %s schema statement %v", patchSchema.Name, err)
		}

		_, err = alterStmt.ExecContext(ar.ctx)
		if err != nil {
			wrappedTx.Rollback()
			return fmt.Errorf("Error patching %s redshift table with '%s' - %s column schema: %v", patchSchema.Name, columnName, mappedColumnType, err)
		}
	}

	return wrappedTx.tx.Commit()
}

func (ar *AwsRedshift) Close() error {
	if err := ar.dataSource.Close(); err != nil {
		return fmt.Errorf("Error closing redshift datasource: %v", err)
	}

	return nil
}

type RedshiftTransaction struct {
	tx *sql.Tx
}

func (rt *RedshiftTransaction) Commit() {
	if err := rt.tx.Commit(); err != nil {
		log.Println("System error: unable to commit redshift transaction", err)
	}
}

func (rt *RedshiftTransaction) Rollback() {
	if err := rt.tx.Rollback(); err != nil {
		log.Println("System error: unable to rollback redshift transaction", err)
	}
}
