package adapters

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/ksensehq/eventnative/schema"
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
)

var (
	schemaToPostgres = map[schema.DataType]string{
		schema.STRING: "character varying(512)",
	}

	postgresToSchema = map[string]schema.DataType{
		"character varying(512)": schema.STRING,
	}
)

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

type Postgres struct {
	ctx        context.Context
	config     *DataSourceConfig
	dataSource *sql.DB
}

func NewPostgres(ctx context.Context, config *DataSourceConfig) (*Postgres, error) {
	connectionString := fmt.Sprintf("host=%s port=%d dbname=%s connect_timeout=%d  user=%s password=%s",
		config.Host, config.Port, config.Db, connectTimeoutSeconds, config.Username, config.Password)
	dataSource, err := sql.Open("postgres", connectionString)

	if err != nil {
		return nil, err
	}
	if err := dataSource.Ping(); err != nil {
		return nil, err
	}

	return &Postgres{ctx: ctx, config: config, dataSource: dataSource}, nil
}

func (Postgres) Name() string {
	return "Postgres"
}

func (p *Postgres) OpenTx() (*Transaction, error) {
	tx, err := p.dataSource.BeginTx(p.ctx, nil)
	if err != nil {
		return nil, err
	}

	return &Transaction{tx: tx, dbType: p.Name()}, nil
}

func (p *Postgres) CreateDbSchema(dbSchemaName string) error {
	wrappedTx, err := p.OpenTx()
	if err != nil {
		return err
	}

	createStmt, err := wrappedTx.tx.PrepareContext(p.ctx, fmt.Sprintf(createDbSchemaIfNotExistsTemplate, dbSchemaName))
	if err != nil {
		wrappedTx.Rollback()
		return fmt.Errorf("Error preparing create db schema %s statement: %v", dbSchemaName, err)
	}

	_, err = createStmt.ExecContext(p.ctx)

	if err != nil {
		wrappedTx.Rollback()
		return fmt.Errorf("Error creating [%s] db schema: %v", dbSchemaName, err)
	}
	return wrappedTx.tx.Commit()
}

func (p *Postgres) TablesList() ([]string, error) {
	var tableNames []string
	rows, err := p.dataSource.QueryContext(p.ctx, tableNamesQuery, p.config.Schema)
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

func (p *Postgres) GetTableSchema(tableName string) (*schema.Table, error) {
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
		mappedType, ok := postgresToSchema[columnPostgresType]
		if !ok {
			log.Println("Unknown postgres column type:", columnPostgresType)
			mappedType = schema.STRING
		}
		table.Columns[columnName] = schema.Column{Type: mappedType}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("Last rows.Err: %v", err)
	}

	return table, nil
}

func (p *Postgres) CreateTable(tableSchema *schema.Table) error {
	wrappedTx, err := p.OpenTx()
	if err != nil {
		return err
	}

	var columnsDDL []string
	for columnName, column := range tableSchema.Columns {
		mappedType, ok := schemaToPostgres[column.Type]
		if !ok {
			log.Println("Unknown postgres schema type:", column.Type)
			mappedType = schemaToPostgres[schema.STRING]
		}
		columnsDDL = append(columnsDDL, fmt.Sprintf(`%s %s`, columnName, mappedType))
	}

	createStmt, err := wrappedTx.tx.PrepareContext(p.ctx, fmt.Sprintf(createTableTemplate, p.config.Schema, tableSchema.Name, strings.Join(columnsDDL, ",")))
	if err != nil {
		wrappedTx.Rollback()
		return fmt.Errorf("Error preparing create table %s statement: %v", tableSchema.Name, err)
	}

	_, err = createStmt.ExecContext(p.ctx)

	if err != nil {
		wrappedTx.Rollback()
		return fmt.Errorf("Error creating [%s] table: %v", tableSchema.Name, err)
	}
	return wrappedTx.tx.Commit()
}

func (p *Postgres) PatchTableSchema(patchSchema *schema.Table) error {
	wrappedTx, err := p.OpenTx()
	if err != nil {
		return err
	}

	for columnName, column := range patchSchema.Columns {
		mappedColumnType, ok := schemaToPostgres[column.Type]
		if !ok {
			log.Println("Unknown postgres schema type:", column.Type.String())
			mappedColumnType = schemaToPostgres[schema.STRING]
		}
		alterStmt, err := wrappedTx.tx.PrepareContext(p.ctx, fmt.Sprintf(addColumnTemplate, p.config.Schema, patchSchema.Name, columnName, mappedColumnType))
		if err != nil {
			wrappedTx.Rollback()
			return fmt.Errorf("Error preparing patching table %s schema statement: %v", patchSchema.Name, err)
		}

		_, err = alterStmt.ExecContext(p.ctx)
		if err != nil {
			wrappedTx.Rollback()
			return fmt.Errorf("Error patching %s table with '%s' - %s column schema: %v", patchSchema.Name, columnName, mappedColumnType, err)
		}
	}

	return wrappedTx.tx.Commit()
}

func (p *Postgres) Close() error {
	if err := p.dataSource.Close(); err != nil {
		return fmt.Errorf("Error closing datasource: %v", err)
	}

	return nil
}

type Transaction struct {
	dbType string
	tx     *sql.Tx
}

func (t *Transaction) Commit() {
	if err := t.tx.Commit(); err != nil {
		log.Printf("System error: unable to commit %s transaction: %v", t.dbType, err)
	}
}

func (t *Transaction) Rollback() {
	if err := t.tx.Rollback(); err != nil {
		log.Printf("System error: unable to rollback %s transaction: %v", t.dbType, err)
	}
}
