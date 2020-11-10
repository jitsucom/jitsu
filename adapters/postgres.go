package adapters

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/ksensehq/eventnative/logging"
	"github.com/ksensehq/eventnative/schema"
	"github.com/ksensehq/eventnative/typing"
	_ "github.com/lib/pq"
	"sort"
	"strconv"
	"strings"
)

const (
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
	primaryKeyFieldsQuery = `SELECT
							pg_attribute.attname
						FROM pg_index, pg_class, pg_attribute, pg_namespace
						WHERE
								pg_class.oid = $1::regclass AND
								indrelid = pg_class.oid AND
								nspname = $2 AND
								pg_class.relnamespace = pg_namespace.oid AND
								pg_attribute.attrelid = pg_class.oid AND
								pg_attribute.attnum = any(pg_index.indkey)
					  	AND indisprimary`
	createDbSchemaIfNotExistsTemplate = `CREATE SCHEMA IF NOT EXISTS "%s"`
	addColumnTemplate                 = `ALTER TABLE "%s"."%s" ADD COLUMN %s %s`
	dropPrimaryKeyTemplate            = "ALTER TABLE %s.%s DROP CONSTRAINT IF EXISTS %s"
	alterPrimaryKeyTemplate           = `ALTER TABLE "%s"."%s" ADD CONSTRAINT %s PRIMARY KEY (%s)`
	createTableTemplate               = `CREATE TABLE "%s"."%s" (%s)`
	insertTemplate                    = `INSERT INTO "%s"."%s" (%s) VALUES (%s)`
	mergeTemplate                     = `INSERT INTO %s.%s(%s) VALUES(%s) ON CONFLICT ON CONSTRAINT %s DO UPDATE set %s;`
)

var (
	schemaToPostgres = map[typing.DataType]string{
		typing.STRING:    "character varying(8192)",
		typing.INT64:     "bigint",
		typing.FLOAT64:   "numeric(38,18)",
		typing.TIMESTAMP: "timestamp",
	}

	postgresToSchema = map[string]typing.DataType{
		"character varying(512)":      typing.STRING,
		"character varying(8192)":     typing.STRING,
		"bigint":                      typing.INT64,
		"numeric(40,20)":              typing.FLOAT64,
		"numeric(38,18)":              typing.FLOAT64,
		"timestamp without time zone": typing.TIMESTAMP,
	}
)

//DataSourceConfig dto for deserialized datasource config (e.g. in Postgres or AwsRedshift destination)
type DataSourceConfig struct {
	Host       string            `mapstructure:"host" json:"host,omitempty" yaml:"host,omitempty"`
	Port       int               `mapstructure:"port" json:"port,omitempty" yaml:"port,omitempty"`
	Db         string            `mapstructure:"db" json:"db,omitempty" yaml:"db,omitempty"`
	Schema     string            `mapstructure:"schema" json:"schema,omitempty" yaml:"schema,omitempty"`
	Username   string            `mapstructure:"username" json:"username,omitempty" yaml:"username,omitempty"`
	Password   string            `mapstructure:"password" json:"password,omitempty" yaml:"password,omitempty"`
	Parameters map[string]string `mapstructure:"parameters" json:"parameters,omitempty" yaml:"parameters,omitempty"`
}

//Validate required fields in DataSourceConfig
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

	if dsc.Parameters == nil {
		dsc.Parameters = map[string]string{}
	}
	return nil
}

//Postgres is adapter for creating,patching (schema or table), inserting data to postgres
type Postgres struct {
	ctx        context.Context
	config     *DataSourceConfig
	dataSource *sql.DB
}

//NewPostgres return configured Postgres adapter instance
func NewPostgres(ctx context.Context, config *DataSourceConfig) (*Postgres, error) {
	connectionString := fmt.Sprintf("host=%s port=%d dbname=%s user=%s password=%s ",
		config.Host, config.Port, config.Db, config.Username, config.Password)
	//concat provided connection parameters
	for k, v := range config.Parameters {
		connectionString += k + "=" + v + " "
	}
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

//OpenTx open underline sql transaction and return wrapped instance
func (p *Postgres) OpenTx() (*Transaction, error) {
	tx, err := p.dataSource.BeginTx(p.ctx, nil)
	if err != nil {
		return nil, err
	}

	return &Transaction{tx: tx, dbType: p.Name()}, nil
}

//CreateDbSchema create database schema instance if doesn't exist
func (p *Postgres) CreateDbSchema(dbSchemaName string) error {
	wrappedTx, err := p.OpenTx()
	if err != nil {
		return err
	}

	return createDbSchemaInTransaction(p.ctx, wrappedTx, createDbSchemaIfNotExistsTemplate, dbSchemaName)
}

//CreateTable create database table with name,columns provided in schema.Table representation
func (p *Postgres) CreateTable(tableSchema *schema.Table) error {
	wrappedTx, err := p.OpenTx()
	if err != nil {
		return err
	}

	return p.createTableInTransaction(wrappedTx, tableSchema)
}

//PatchTableSchema add new columns(from provided schema.Table) to existing table
func (p *Postgres) PatchTableSchema(patchSchema *schema.Table) error {
	wrappedTx, err := p.OpenTx()
	if err != nil {
		return err
	}

	return p.patchTableSchemaInTransaction(wrappedTx, patchSchema)
}

//GetTableSchema return table (name,columns with name and types) representation wrapped in schema.Table struct
func (p *Postgres) GetTableSchema(tableName string) (*schema.Table, error) {
	table := &schema.Table{Name: tableName, Columns: schema.Columns{}, PKFields: map[string]bool{}}
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
		mappedType, ok := postgresToSchema[strings.ToLower(columnPostgresType)]
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
	if !table.Exists() {
		return table, nil
	}

	pkFieldsRows, err := p.dataSource.QueryContext(p.ctx, primaryKeyFieldsQuery, p.config.Schema+"."+tableName, p.config.Schema)
	if err != nil {
		return nil, fmt.Errorf("error querying primary keys for [%s.%s] schema: %v", p.config.Schema, tableName, err)
	}
	defer pkFieldsRows.Close()
	var pkFields []string
	for pkFieldsRows.Next() {
		var fieldName string
		if err := pkFieldsRows.Scan(&fieldName); err != nil {
			return nil, fmt.Errorf("error scanning primary key result: %v", err)
		}
		pkFields = append(pkFields, fieldName)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("pk last rows.Err: %v", err)
	}
	for _, field := range pkFields {
		table.PKFields[field] = true
	}

	return table, nil
}

func (p *Postgres) createTableInTransaction(wrappedTx *Transaction, tableSchema *schema.Table) error {
	var columnsDDL []string
	for columnName, column := range tableSchema.Columns {
		mappedType, ok := schemaToPostgres[column.GetType()]
		if !ok {
			logging.Error("Unknown postgres schema type:", column.GetType())
			mappedType = schemaToPostgres[typing.STRING]
		}
		columnsDDL = append(columnsDDL, fmt.Sprintf(`%s %s`, columnName, mappedType))
	}

	//sorting columns asc
	sort.Strings(columnsDDL)
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

func (p *Postgres) patchTableSchemaInTransaction(wrappedTx *Transaction, patchSchema *schema.Table) error {
	for columnName, column := range patchSchema.Columns {
		mappedColumnType, ok := schemaToPostgres[column.GetType()]
		if !ok {
			logging.Error("Unknown postgres schema type:", column.GetType().String())
			mappedColumnType = schemaToPostgres[typing.STRING]
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

func (p *Postgres) UpdatePrimaryKey(patchTableSchema *schema.Table, patchConstraint *schema.PKFieldsPatch) error {
	wrappedTx, err := p.OpenTx()
	if err != nil {
		wrappedTx.Rollback()
		return err
	}
	constraint := buildConstraintName(p.config.Schema, patchTableSchema.Name)

	if len(patchConstraint.PKFields) > 0 || patchConstraint.Remove {
		dropPKStmt, err := wrappedTx.tx.PrepareContext(p.ctx, fmt.Sprintf(dropPrimaryKeyTemplate, p.config.Schema, patchTableSchema.Name, constraint))
		if err != nil {
			wrappedTx.tx.Rollback()
			return fmt.Errorf("failed to prepare statement to drop primary key for table %s: %v", patchTableSchema.Name, err)
		}
		_, err = dropPKStmt.ExecContext(p.ctx)
		if err != nil {
			wrappedTx.Rollback()
			return fmt.Errorf("failed to drop primary key constraint for table %s: %v", patchTableSchema.Name, err)
		}
	}

	if len(patchConstraint.PKFields) > 0 {
		alterConstraintStmt, err := wrappedTx.tx.PrepareContext(p.ctx, fmt.Sprintf(alterPrimaryKeyTemplate,
			p.config.Schema, patchTableSchema.Name, constraint, strings.Join(schema.PkToFieldsArray(patchConstraint.PKFields), ",")))
		if err != nil {
			wrappedTx.Rollback()
			return fmt.Errorf("error preparing primary key setting to table %s: %v", patchTableSchema.Name, err)
		}
		_, err = alterConstraintStmt.ExecContext(p.ctx)
		if err != nil {
			wrappedTx.Rollback()
			return fmt.Errorf("error setting primary key %s table: %v", patchTableSchema.Name, err)
		}
	}
	return wrappedTx.tx.Commit()
}

//Insert provided object in postgres
func (p *Postgres) Insert(schema *schema.Table, valuesMap map[string]interface{}) error {
	wrappedTx, err := p.OpenTx()
	if err != nil {
		return err
	}

	if err := p.InsertInTransaction(wrappedTx, schema, valuesMap); err != nil {
		wrappedTx.Rollback()
		return err
	}

	return wrappedTx.DirectCommit()
}

func (p *Postgres) InsertInTransaction(wrappedTx *Transaction, table *schema.Table, valuesMap map[string]interface{}) error {
	var header, placeholders string
	var values []interface{}
	i := 1
	for name, value := range valuesMap {
		header += name + ","
		//$1, $2, $3, etc
		placeholders += "$" + strconv.Itoa(i) + ","
		values = append(values, value)
		i++
	}

	header = removeLastComma(header)
	placeholders = removeLastComma(placeholders)
	query := p.insertQuery(schema.PkToFieldsArray(table.PKFields), table.Name, header, placeholders)
	insertStmt, err := wrappedTx.tx.PrepareContext(p.ctx, query)
	if err != nil {
		return fmt.Errorf("Error preparing insert table %s statement: %v", table.Name, err)
	}

	_, err = insertStmt.ExecContext(p.ctx, values...)
	if err != nil {
		return fmt.Errorf("Error inserting in %s table with statement: %s values: %v: %v", table.Name, header, values, err)
	}

	return nil
}

func (p *Postgres) insertQuery(pkFields []string, tableName string, header string, placeholders string) string {
	if len(pkFields) == 0 {
		return fmt.Sprintf(insertTemplate, p.config.Schema, tableName, header, placeholders)
	} else {
		return fmt.Sprintf(mergeTemplate, p.config.Schema, tableName, header, placeholders, buildConstraintName(p.config.Schema, tableName), updateSection(header))
	}
}

func buildConstraintName(schemaName string, tableName string) string {
	return schemaName + "_" + tableName + "_pk"
}

func updateSection(header string) string {
	split := strings.Split(header, ",")
	var result string
	for i, columnName := range split {
		result = strings.TrimSpace(result) + columnName + "=$" + strconv.Itoa(i+1) + ","
	}
	return removeLastComma(result)
}

//TablesList return slice of postgres table names
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

//Close underlying sql.DB
func (p *Postgres) Close() error {
	return p.dataSource.Close()
}

//Transaction is sql transaction wrapper. Used for handling and log errors with db type (postgres, redshift, clickhouse or snowflake)
//on Commit() and Rollback() calls
//Use DirectCommit() if you need not to swallow an error on commit
type Transaction struct {
	dbType string
	tx     *sql.Tx
}

func (t *Transaction) Commit() {
	if err := t.tx.Commit(); err != nil {
		logging.Errorf("System error: unable to commit %s transaction: %v", t.dbType, err)
	}
}

func (t *Transaction) DirectCommit() error {
	if err := t.tx.Commit(); err != nil {
		return fmt.Errorf("Unable to commit %s transaction: %v", t.dbType, err)
	}

	return nil
}

func (t *Transaction) Rollback() {
	if err := t.tx.Rollback(); err != nil {
		logging.Errorf("System error: unable to rollback %s transaction: %v", t.dbType, err)
	}
}

func createDbSchemaInTransaction(ctx context.Context, wrappedTx *Transaction, statementTemplate, dbSchemaName string) error {
	createStmt, err := wrappedTx.tx.PrepareContext(ctx, fmt.Sprintf(statementTemplate, dbSchemaName))
	if err != nil {
		wrappedTx.Rollback()
		return fmt.Errorf("Error preparing create db schema %s statement: %v", dbSchemaName, err)
	}

	_, err = createStmt.ExecContext(ctx)

	if err != nil {
		wrappedTx.Rollback()
		return fmt.Errorf("Error creating [%s] db schema: %v", dbSchemaName, err)
	}

	return wrappedTx.tx.Commit()
}

func removeLastComma(str string) string {
	if last := len(str) - 1; last >= 0 && str[last] == ',' {
		str = str[:last]
	}

	return str
}
