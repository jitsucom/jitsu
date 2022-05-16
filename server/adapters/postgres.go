package adapters

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/server/errorj"
	"github.com/jitsucom/jitsu/server/uuid"
	"github.com/lib/pq"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/typing"
	_ "github.com/lib/pq"
)

const (
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
	primaryKeyFieldsQuery = `SELECT tco.constraint_name as constraint_name,
       kcu.column_name as key_column
FROM information_schema.table_constraints tco
         JOIN information_schema.key_column_usage kcu
              ON kcu.constraint_name = tco.constraint_name
                  AND kcu.constraint_schema = tco.constraint_schema
                  AND kcu.constraint_name = tco.constraint_name
WHERE tco.constraint_type = 'PRIMARY KEY' AND 
      kcu.table_schema = $1 AND
      kcu.table_name = $2`
	createDbSchemaIfNotExistsTemplate = `CREATE SCHEMA IF NOT EXISTS "%s"`
	addColumnTemplate                 = `ALTER TABLE "%s"."%s" ADD COLUMN %s`
	dropPrimaryKeyTemplate            = `ALTER TABLE "%s"."%s" DROP CONSTRAINT %s`
	alterPrimaryKeyTemplate           = `ALTER TABLE "%s"."%s" ADD CONSTRAINT %s PRIMARY KEY (%s)`
	createTableTemplate               = `CREATE TABLE "%s"."%s" (%s)`
	insertTemplate                    = `INSERT INTO "%s"."%s" (%s) VALUES %s`
	mergeTemplate                     = `INSERT INTO "%s"."%s"(%s) VALUES %s ON CONFLICT ON CONSTRAINT %s DO UPDATE set %s;`
	bulkMergeTemplate                 = `INSERT INTO "%s"."%s"(%s) SELECT %s FROM "%s"."%s" ON CONFLICT ON CONSTRAINT %s DO UPDATE SET %s`
	bulkMergePrefix                   = `excluded`
	deleteQueryTemplate               = `DELETE FROM "%s"."%s" WHERE %s`

	updateStatement   = `UPDATE "%s"."%s" SET %s WHERE %s=$%d`
	dropTableTemplate = `DROP TABLE "%s"."%s"`

	copyColumnTemplate            = `UPDATE "%s"."%s" SET %s = %s`
	dropColumnTemplate            = `ALTER TABLE "%s"."%s" DROP COLUMN %s`
	renameColumnTemplate          = `ALTER TABLE "%s"."%s" RENAME COLUMN %s TO %s`
	postgresTruncateTableTemplate = `TRUNCATE "%s"."%s"`
	PostgresValuesLimit           = 65535 // this is a limitation of parameters one can pass as query values. If more parameters are passed, error is returned
)

var (
	SchemaToPostgres = map[typing.DataType]string{
		typing.STRING:    "text",
		typing.INT64:     "bigint",
		typing.FLOAT64:   "double precision",
		typing.TIMESTAMP: "timestamp",
		typing.BOOL:      "boolean",
		typing.UNKNOWN:   "text",
	}
)

type ErrorPayload struct {
	Dataset         string
	Bucket          string
	Project         string
	Database        string
	Cluster         string
	Schema          string
	Table           string
	PrimaryKeys     []string
	Statement       string
	Values          []interface{}
	ValuesMapString string
	TotalObjects    int
}

func (ep *ErrorPayload) String() string {
	var msgParts []string
	if ep.Dataset != "" {
		msgParts = append(msgParts, fmt.Sprintf("dataset=%s", ep.Dataset))
	}
	if ep.Bucket != "" {
		msgParts = append(msgParts, fmt.Sprintf("bucket=%s", ep.Bucket))
	}
	if ep.Project != "" {
		msgParts = append(msgParts, fmt.Sprintf("project=%s", ep.Project))
	}
	if ep.Database != "" {
		msgParts = append(msgParts, fmt.Sprintf("database=%s", ep.Database))
	}
	if ep.Cluster != "" {
		msgParts = append(msgParts, fmt.Sprintf("cluster=%s", ep.Cluster))
	}
	if ep.Schema != "" {
		msgParts = append(msgParts, fmt.Sprintf("schema=%s", ep.Schema))
	}
	if ep.Table != "" {
		msgParts = append(msgParts, fmt.Sprintf("table=%s", ep.Table))
	}
	if len(ep.PrimaryKeys) > 0 {
		msgParts = append(msgParts, fmt.Sprintf("primary keys=%v", ep.PrimaryKeys))
	}
	if ep.Statement != "" {
		msgParts = append(msgParts, fmt.Sprintf("statement=%s", ep.Statement))
	}
	if len(ep.Values) > 0 {
		msgParts = append(msgParts, fmt.Sprintf("values=%v", ep.Values))
	}
	if ep.TotalObjects > 1 {
		msgParts = append(msgParts, fmt.Sprintf("objects count=%d", ep.TotalObjects))
	}
	if ep.ValuesMapString != "" {
		msgParts = append(msgParts, fmt.Sprintf("values map of 1st object=%s", ep.ValuesMapString))
	}

	return strings.Join(msgParts, ", ")
}

func ObjectValuesToString(header []string, valueArgs []interface{}) string {
	var firstObjectValues strings.Builder
	firstObjectValues.WriteString("{")
	for i, name := range header {
		if i != 0 {
			firstObjectValues.WriteString(", ")
		}
		firstObjectValues.WriteString(name + ": " + fmt.Sprint(valueArgs[i]))
	}
	firstObjectValues.WriteString("}")
	return firstObjectValues.String()
}

//DataSourceConfig dto for deserialized datasource config (e.g. in Postgres or AwsRedshift destination)
type DataSourceConfig struct {
	Host             string            `mapstructure:"host,omitempty" json:"host,omitempty" yaml:"host,omitempty"`
	Port             int               `mapstructure:"port,omitempty" json:"port,omitempty" yaml:"port,omitempty"`
	Db               string            `mapstructure:"db,omitempty" json:"db,omitempty" yaml:"db,omitempty"`
	Schema           string            `mapstructure:"schema,omitempty" json:"schema,omitempty" yaml:"schema,omitempty"`
	Username         string            `mapstructure:"username,omitempty" json:"username,omitempty" yaml:"username,omitempty"`
	Password         string            `mapstructure:"password,omitempty" json:"password,omitempty" yaml:"password,omitempty"`
	Parameters       map[string]string `mapstructure:"parameters,omitempty" json:"parameters,omitempty" yaml:"parameters,omitempty"`
	SSLConfiguration *SSLConfig        `mapstructure:"ssl,omitempty" json:"ssl,omitempty" yaml:"ssl,omitempty"`
	S3               *S3Config         `mapstructure:"s3,omitempty" json:"s3,omitempty" yaml:"s3,omitempty"`
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

	if dsc.SSLConfiguration != nil {
		if err := dsc.SSLConfiguration.Validate(); err != nil {
			return err
		}
	}
	return nil
}

//Postgres is adapter for creating,patching (schema or table), inserting data to postgres
type Postgres struct {
	ctx         context.Context
	config      *DataSourceConfig
	dataSource  *sql.DB
	queryLogger *logging.QueryLogger

	sqlTypes typing.SQLTypes
}

//NewPostgresUnderRedshift returns configured Postgres adapter instance without mapping old types
func NewPostgresUnderRedshift(ctx context.Context, config *DataSourceConfig, queryLogger *logging.QueryLogger, sqlTypes typing.SQLTypes) (*Postgres, error) {
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
		dataSource.Close()
		return nil, err
	}

	//set default value
	dataSource.SetConnMaxLifetime(10 * time.Minute)

	return &Postgres{ctx: ctx, config: config, dataSource: dataSource, queryLogger: queryLogger, sqlTypes: sqlTypes}, nil
}

//NewPostgres return configured Postgres adapter instance
func NewPostgres(ctx context.Context, config *DataSourceConfig, queryLogger *logging.QueryLogger, sqlTypes typing.SQLTypes) (*Postgres, error) {
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
		dataSource.Close()
		return nil, err
	}

	//set default value
	dataSource.SetConnMaxLifetime(10 * time.Minute)

	return &Postgres{ctx: ctx, config: config, dataSource: dataSource, queryLogger: queryLogger, sqlTypes: reformatMappings(sqlTypes, SchemaToPostgres)}, nil
}

//Type returns Postgres type
func (Postgres) Type() string {
	return "Postgres"
}

//OpenTx opens underline sql transaction and return wrapped instance
func (p *Postgres) OpenTx() (*Transaction, error) {
	tx, err := p.dataSource.BeginTx(p.ctx, nil)
	if err != nil {
		err = checkErr(err)
		return nil, errorj.BeginTransactionError.Wrap(err, "failed to begin transaction").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Schema: p.config.Schema,
			})
	}

	return &Transaction{tx: tx, dbType: p.Type()}, nil
}

//CreateDbSchema creates database schema instance if doesn't exist
func (p *Postgres) CreateDbSchema(dbSchemaName string) error {
	query := fmt.Sprintf(createDbSchemaIfNotExistsTemplate, dbSchemaName)
	p.queryLogger.LogDDL(query)

	if _, err := p.dataSource.ExecContext(p.ctx, query); err != nil {
		err = checkErr(err)

		return errorj.CreateSchemaError.Wrap(err, "failed to create db schema").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Schema:    dbSchemaName,
				Statement: query,
			})
	}

	return nil
}

//CreateTable creates database table with name,columns provided in Table representation
func (p *Postgres) CreateTable(table *Table) (err error) {
	wrappedTx, err := p.OpenTx()
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

	return p.createTableInTransaction(wrappedTx, table)
}

//PatchTableSchema adds new columns(from provided Table) to existing table
func (p *Postgres) PatchTableSchema(patchTable *Table) (err error) {
	wrappedTx, err := p.OpenTx()
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

	return p.patchTableSchemaInTransaction(wrappedTx, patchTable)
}

//GetTableSchema returns table (name,columns with name and types) representation wrapped in Table struct
func (p *Postgres) GetTableSchema(tableName string) (*Table, error) {
	table, err := p.getTable(tableName)
	if err != nil {
		return nil, err
	}

	//don't select primary keys of non-existent table
	if len(table.Columns) == 0 {
		return table, nil
	}

	primaryKeyName, pkFields, err := p.getPrimaryKey(tableName)
	if err != nil {
		return nil, err
	}

	table.PKFields = pkFields
	table.PrimaryKeyName = primaryKeyName

	jitsuPrimaryKeyName := BuildConstraintName(table.Schema, table.Name)
	if primaryKeyName != "" && primaryKeyName != jitsuPrimaryKeyName {
		logging.Warnf("[%s] table: %s.%s has a custom primary key with name: %s that isn't managed by Jitsu. Custom primary key will be used in rows deduplication and updates. primary_key_fields configuration provided in Jitsu config will be ignored.", p.destinationId(), table.Schema, table.Name, primaryKeyName)
	}
	return table, nil
}

//Insert inserts data with InsertContext as a single object or a batch into Redshift
func (p *Postgres) Insert(insertContext *InsertContext) error {
	return p.insertBatch(insertContext.table, insertContext.objects, insertContext.deleteConditions)
}

func (p *Postgres) insertBatch(table *Table, objects []map[string]interface{}, deleteConditions *DeleteConditions) (err error) {
	wrappedTx, err := p.OpenTx()
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
		if err = p.deleteInTransaction(wrappedTx, table, deleteConditions); err != nil {
			return err
		}
	}

	if len(table.PKFields) == 0 {
		return p.bulkInsertInTransaction(wrappedTx, table, objects, PostgresValuesLimit)
	}

	//deduplication for bulkMerge success (it fails if there is any duplicate)
	deduplicatedObjectsBuckets := deduplicateObjects(table, objects)

	for _, objectsBucket := range deduplicatedObjectsBuckets {
		if err = p.bulkMergeInTransaction(wrappedTx, table, objectsBucket); err != nil {
			return err
		}
	}

	return nil
}

//insertSingle inserts single provided object in postgres with typecasts
//uses upsert (merge on conflict) if primary_keys are configured
func (p *Postgres) insertSingle(eventContext *EventContext) error {
	columnsWithoutQuotes, columnsWithQuotes, placeholders, values := p.buildInsertPayload(eventContext.Table, eventContext.ProcessedEvent)

	var statement string
	if len(eventContext.Table.PKFields) == 0 {
		statement = fmt.Sprintf(insertTemplate, p.config.Schema, eventContext.Table.Name, strings.Join(columnsWithQuotes, ", "), "("+strings.Join(placeholders, ", ")+")")
	} else {
		statement = fmt.Sprintf(mergeTemplate, p.config.Schema, eventContext.Table.Name, strings.Join(columnsWithQuotes, ","), "("+strings.Join(placeholders, ", ")+")", eventContext.Table.PrimaryKeyName, p.buildUpdateSection(columnsWithoutQuotes))
	}

	p.queryLogger.LogQueryWithValues(statement, values)

	if _, err := p.dataSource.ExecContext(p.ctx, statement, values...); err != nil {
		err = checkErr(err)

		return errorj.ExecuteInsertError.Wrap(err, "failed to execute single insert").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Schema:      p.config.Schema,
				Table:       eventContext.Table.Name,
				PrimaryKeys: eventContext.Table.GetPKFields(),
				Statement:   statement,
				Values:      values,
			})
	}

	return nil
}

//Truncate deletes all records in tableName table
func (p *Postgres) Truncate(tableName string) error {
	sqlParams := SqlParams{
		dataSource:  p.dataSource,
		queryLogger: p.queryLogger,
		ctx:         p.ctx,
	}
	statement := fmt.Sprintf(postgresTruncateTableTemplate, p.config.Schema, tableName)
	if err := sqlParams.commonTruncate(statement); err != nil {
		return errorj.TruncateError.Wrap(err, "failed to truncate table").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Schema:    p.config.Schema,
				Table:     tableName,
				Statement: statement,
			})
	}

	return nil
}

func (p *Postgres) getTable(tableName string) (*Table, error) {
	table := &Table{Schema: p.config.Schema, Name: tableName, Columns: map[string]typing.SQLColumn{}, PKFields: map[string]bool{}}
	rows, err := p.dataSource.QueryContext(p.ctx, tableSchemaQuery, p.config.Schema, tableName)
	if err != nil {
		err = checkErr(err)
		return nil, errorj.GetTableError.Wrap(err, "failed to get table columns").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Schema:      p.config.Schema,
				Table:       table.Name,
				PrimaryKeys: table.GetPKFields(),
				Statement:   tableSchemaQuery,
				Values:      []interface{}{p.config.Schema, tableName},
			})
	}

	defer rows.Close()
	for rows.Next() {
		var columnName, columnPostgresType string
		if err := rows.Scan(&columnName, &columnPostgresType); err != nil {
			return nil, errorj.GetTableError.Wrap(err, "failed to scan result").
				WithProperty(errorj.DBInfo, &ErrorPayload{
					Schema:      p.config.Schema,
					Table:       table.Name,
					PrimaryKeys: table.GetPKFields(),
					Statement:   tableSchemaQuery,
					Values:      []interface{}{p.config.Schema, tableName},
				})
		}
		if columnPostgresType == "-" {
			//skip dropped postgres field
			continue
		}

		table.Columns[columnName] = typing.SQLColumn{Type: columnPostgresType}
	}

	if err := rows.Err(); err != nil {
		return nil, errorj.GetTableError.Wrap(err, "failed read last row").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Schema:      p.config.Schema,
				Table:       table.Name,
				PrimaryKeys: table.GetPKFields(),
				Statement:   tableSchemaQuery,
				Values:      []interface{}{p.config.Schema, tableName},
			})
	}

	return table, nil
}

//create table columns and pk key
//override input table sql type with configured cast type
//make fields from Table PkFields - 'not null'
func (p *Postgres) createTableInTransaction(wrappedTx *Transaction, table *Table) error {
	var columnsDDL []string
	pkFields := table.GetPKFieldsMap()
	for _, columnName := range table.SortedColumnNames() {
		column := table.Columns[columnName]
		columnsDDL = append(columnsDDL, p.columnDDL(columnName, column, pkFields))
	}

	//sorting columns asc
	sort.Strings(columnsDDL)
	query := fmt.Sprintf(createTableTemplate, p.config.Schema, table.Name, strings.Join(columnsDDL, ", "))
	p.queryLogger.LogDDL(query)

	if _, err := wrappedTx.tx.ExecContext(p.ctx, query); err != nil {
		err = checkErr(err)

		return errorj.CreateTableError.Wrap(err, "failed to create table").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Schema:      p.config.Schema,
				Table:       table.Name,
				PrimaryKeys: table.GetPKFields(),
				Statement:   query,
			})
	}

	if err := p.createPrimaryKeyInTransaction(wrappedTx, table); err != nil {
		return err
	}

	return nil
}

//alter table with columns (if not empty)
//recreate primary key (if not empty) or delete primary key if Table.DeletePkFields is true
func (p *Postgres) patchTableSchemaInTransaction(wrappedTx *Transaction, patchTable *Table) error {
	pkFields := patchTable.GetPKFieldsMap()
	//patch columns
	for _, columnName := range patchTable.SortedColumnNames() {
		column := patchTable.Columns[columnName]
		columnDDL := p.columnDDL(columnName, column, pkFields)
		query := fmt.Sprintf(addColumnTemplate, p.config.Schema, patchTable.Name, columnDDL)
		p.queryLogger.LogDDL(query)

		if _, err := wrappedTx.tx.ExecContext(p.ctx, query); err != nil {
			err = checkErr(err)
			return errorj.PatchTableError.Wrap(err, "failed to patch table").
				WithProperty(errorj.DBInfo, &ErrorPayload{
					Schema:      p.config.Schema,
					Table:       patchTable.Name,
					PrimaryKeys: patchTable.GetPKFields(),
					Statement:   query,
				})
		}
	}

	//patch primary keys - delete old
	if patchTable.DeletePkFields {
		err := p.deletePrimaryKeyInTransaction(wrappedTx, patchTable)
		if err != nil {
			return err
		}
	}

	//patch primary keys - create new
	if len(patchTable.PKFields) > 0 {
		err := p.createPrimaryKeyInTransaction(wrappedTx, patchTable)
		if err != nil {
			return err
		}
	}

	return nil
}

//createPrimaryKeyInTransaction create primary key constraint
func (p *Postgres) createPrimaryKeyInTransaction(wrappedTx *Transaction, table *Table) error {
	if len(table.PKFields) == 0 {
		return nil
	}

	var quotedColumnNames []string
	for _, column := range table.GetPKFields() {
		quotedColumnNames = append(quotedColumnNames, fmt.Sprintf(`"%s"`, column))
	}

	statement := fmt.Sprintf(alterPrimaryKeyTemplate,
		p.config.Schema, table.Name, table.PrimaryKeyName, strings.Join(quotedColumnNames, ","))
	p.queryLogger.LogDDL(statement)

	if _, err := wrappedTx.tx.ExecContext(p.ctx, statement); err != nil {
		err = checkErr(err)
		return errorj.CreatePrimaryKeysError.Wrap(err, "failed to set primary key").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Schema:      p.config.Schema,
				Table:       table.Name,
				PrimaryKeys: table.GetPKFields(),
				Statement:   statement,
			})
	}

	return nil
}

//delete primary key
func (p *Postgres) deletePrimaryKeyInTransaction(wrappedTx *Transaction, table *Table) error {
	query := fmt.Sprintf(dropPrimaryKeyTemplate, p.config.Schema, table.Name, table.PrimaryKeyName)
	p.queryLogger.LogDDL(query)

	if _, err := wrappedTx.tx.ExecContext(p.ctx, query); err != nil {
		err = checkErr(err)
		return errorj.DeletePrimaryKeysError.Wrap(err, "failed to delete primary key").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Schema:      p.config.Schema,
				Table:       table.Name,
				PrimaryKeys: table.GetPKFields(),
				Statement:   query,
			})
	}

	return nil
}

//DropTable drops table in transaction
func (p *Postgres) DropTable(table *Table) (err error) {
	wrappedTx, err := p.OpenTx()
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

	return p.dropTableInTransaction(wrappedTx, table)
}

//Update one record in Postgres
func (p *Postgres) Update(table *Table, object map[string]interface{}, whereKey string, whereValue interface{}) error {
	columns := make([]string, len(object), len(object))
	values := make([]interface{}, len(object)+1, len(object)+1)
	i := 0
	for name, value := range object {
		columns[i] = name + "= $" + strconv.Itoa(i+1) //$0 - wrong
		values[i] = value
		i++
	}
	values[i] = whereValue

	statement := fmt.Sprintf(updateStatement, p.config.Schema, table.Name, strings.Join(columns, ", "), whereKey, i+1)
	p.queryLogger.LogQueryWithValues(statement, values)

	if _, err := p.dataSource.ExecContext(p.ctx, statement, values...); err != nil {
		err = checkErr(err)

		return errorj.UpdateError.Wrap(err, "failed to update").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Schema:      p.config.Schema,
				Table:       table.Name,
				PrimaryKeys: table.GetPKFields(),
				Statement:   statement,
				Values:      values,
			})
	}

	return nil
}

//bulkInsertInTransaction should be used when table has no primary keys. Inserts data in batches to improve performance.
func (p *Postgres) bulkInsertInTransaction(wrappedTx *Transaction, table *Table, objects []map[string]interface{}, valuesLimit int) error {
	var placeholdersBuilder strings.Builder
	var headerWithoutQuotes []string
	for _, name := range table.SortedColumnNames() {
		headerWithoutQuotes = append(headerWithoutQuotes, name)
	}
	valuesAmount := len(objects) * len(table.Columns)
	maxValues := valuesAmount
	if maxValues > valuesLimit {
		maxValues = valuesLimit
	}
	valueArgs := make([]interface{}, 0, maxValues)
	placeholdersCounter := 1
	operation := 0
	operations := int(math.Max(1, float64(valuesAmount)/float64(valuesLimit)))
	for _, row := range objects {
		// if number of values exceeds limit, we have to execute insert query on processed rows
		if len(valueArgs)+len(headerWithoutQuotes) > valuesLimit {
			operation++
			if err := p.executeInsertInTransaction(wrappedTx, table, headerWithoutQuotes, removeLastComma(placeholdersBuilder.String()), valueArgs); err != nil {
				return errorj.Decorate(err, "middle insert %d of %d in batch", operation, operations)
			}

			placeholdersBuilder.Reset()
			placeholdersCounter = 1
			valueArgs = make([]interface{}, 0, maxValues)
		}

		_, _ = placeholdersBuilder.WriteString("(")

		for i, column := range headerWithoutQuotes {
			value, _ := row[column]
			//replace zero byte character for text fields
			if table.Columns[column].Type == "text" {
				if v, ok := value.(string); ok {
					if strings.ContainsRune(v, '\u0000') {
						value = strings.ReplaceAll(v, "\u0000", "")
					}
				}
			}
			valueArgs = append(valueArgs, value)
			castClause := p.getCastClause(column, table.Columns[column])

			_, _ = placeholdersBuilder.WriteString("$" + strconv.Itoa(placeholdersCounter) + castClause)

			if i < len(headerWithoutQuotes)-1 {
				_, _ = placeholdersBuilder.WriteString(",")
			}
			placeholdersCounter++
		}
		_, _ = placeholdersBuilder.WriteString("),")
	}

	if len(valueArgs) > 0 {
		operation++
		if err := p.executeInsertInTransaction(wrappedTx, table, headerWithoutQuotes, removeLastComma(placeholdersBuilder.String()), valueArgs); err != nil {
			return errorj.Decorate(err, "last insert %d of %d in batch", operation, operations)
		}
	}

	return nil
}

//bulkMergeInTransaction creates tmp table without duplicates
//inserts all data into tmp table and using bulkMergeTemplate merges all data to main table
func (p *Postgres) bulkMergeInTransaction(wrappedTx *Transaction, table *Table, objects []map[string]interface{}) error {
	tmpTable := &Table{
		Name:           fmt.Sprintf("jitsu_tmp_%s", uuid.NewLettersNumbers()[:5]),
		Columns:        table.Columns,
		PKFields:       map[string]bool{},
		DeletePkFields: false,
	}

	if err := p.createTableInTransaction(wrappedTx, tmpTable); err != nil {
		return errorj.Decorate(err, "failed to create temporary table")
	}

	if err := p.bulkInsertInTransaction(wrappedTx, tmpTable, objects, PostgresValuesLimit); err != nil {
		return errorj.Decorate(err, "failed to insert into temporary table")
	}

	//insert from select
	var setValues []string
	var headerWithQuotes []string
	for _, name := range table.SortedColumnNames() {
		setValues = append(setValues, fmt.Sprintf(`"%s"=%s."%s"`, name, bulkMergePrefix, name))
		headerWithQuotes = append(headerWithQuotes, fmt.Sprintf(`"%s"`, name))
	}

	insertFromSelectStatement := fmt.Sprintf(bulkMergeTemplate, p.config.Schema, table.Name, strings.Join(headerWithQuotes, ", "), strings.Join(headerWithQuotes, ", "), p.config.Schema, tmpTable.Name, table.PrimaryKeyName, strings.Join(setValues, ", "))
	p.queryLogger.LogQuery(insertFromSelectStatement)

	if _, err := wrappedTx.tx.ExecContext(p.ctx, insertFromSelectStatement); err != nil {
		err = checkErr(err)

		return errorj.BulkMergeError.Wrap(err, "failed to bulk merge").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Schema:      p.config.Schema,
				Table:       table.Name,
				PrimaryKeys: table.GetPKFields(),
				Statement:   insertFromSelectStatement,
			})
	}

	//delete tmp table
	if err := p.dropTableInTransaction(wrappedTx, tmpTable); err != nil {
		return errorj.Decorate(err, "failed to drop temporary table")
	}

	return nil
}

func (p *Postgres) dropTableInTransaction(wrappedTx *Transaction, table *Table) error {
	query := fmt.Sprintf(dropTableTemplate, p.config.Schema, table.Name)
	p.queryLogger.LogDDL(query)

	if _, err := wrappedTx.tx.ExecContext(p.ctx, query); err != nil {
		err = checkErr(err)

		return errorj.DropError.Wrap(err, "failed to drop table").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Schema:      p.config.Schema,
				Table:       table.Name,
				PrimaryKeys: table.GetPKFields(),
				Statement:   query,
			})
	}

	return nil
}

func (p *Postgres) deleteInTransaction(wrappedTx *Transaction, table *Table, deleteConditions *DeleteConditions) error {
	deleteCondition, values := p.toDeleteQuery(table, deleteConditions)
	query := fmt.Sprintf(deleteQueryTemplate, p.config.Schema, table.Name, deleteCondition)
	p.queryLogger.LogQueryWithValues(query, values)

	if _, err := wrappedTx.tx.ExecContext(p.ctx, query, values...); err != nil {
		err = checkErr(err)
		return errorj.DeleteFromTableError.Wrap(err, "failed to delete data").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Schema:      p.config.Schema,
				Table:       table.Name,
				PrimaryKeys: table.GetPKFields(),
				Statement:   query,
			})
	}

	return nil
}

func (p *Postgres) toDeleteQuery(table *Table, conditions *DeleteConditions) (string, []interface{}) {
	var queryConditions []string
	var values []interface{}

	for i, condition := range conditions.Conditions {
		conditionString := condition.Field + " " + condition.Clause + " $" + strconv.Itoa(i+1) + p.getCastClause(condition.Field, table.Columns[condition.Field])
		queryConditions = append(queryConditions, conditionString)
		//reformat from json.Number into int64 or float64 and put back
		v := typing.ReformatValue(condition.Value)

		// reformat from string with timestamp into time.Time and put back
		v = typing.ReformatTimeValue(v)
		values = append(values, v)
	}

	return strings.Join(queryConditions, " "+conditions.JoinCondition+" "), values
}

//executeInsert execute insert with insertTemplate
func (p *Postgres) executeInsertInTransaction(wrappedTx *Transaction, table *Table, headerWithoutQuotes []string,
	placeholders string, valueArgs []interface{}) error {
	var quotedHeader []string
	for _, columnName := range headerWithoutQuotes {
		quotedHeader = append(quotedHeader, fmt.Sprintf(`"%s"`, columnName))
	}

	statement := fmt.Sprintf(insertTemplate, p.config.Schema, table.Name, strings.Join(quotedHeader, ","), placeholders)

	p.queryLogger.LogQueryWithValues(statement, valueArgs)

	if _, err := wrappedTx.tx.Exec(statement, valueArgs...); err != nil {
		err = checkErr(err)
		return errorj.ExecuteInsertInBatchError.Wrap(err, "failed to execute insert").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Schema:          p.config.Schema,
				Table:           table.Name,
				PrimaryKeys:     table.GetPKFields(),
				Statement:       statement,
				ValuesMapString: ObjectValuesToString(headerWithoutQuotes, valueArgs),
			})
	}

	return nil
}

//columnDDL returns column DDL (quoted column name, mapped sql type and 'not null' if pk field)
func (p *Postgres) columnDDL(name string, column typing.SQLColumn, pkFields map[string]bool) string {
	var notNullClause string
	sqlType := column.DDLType()

	if overriddenSQLType, ok := p.sqlTypes[name]; ok {
		sqlType = overriddenSQLType.ColumnType
	}

	//not null
	if _, ok := pkFields[name]; ok {
		notNullClause = " not null " + p.getDefaultValueStatement(sqlType)
	}

	return fmt.Sprintf(`"%s" %s%s`, name, sqlType, notNullClause)
}

//getCastClause returns ::SQL_TYPE clause or empty string
//$1::type, $2::type, $3, etc
func (p *Postgres) getCastClause(name string, column typing.SQLColumn) string {
	castType, ok := p.sqlTypes[name]
	if !ok && column.Override {
		castType = column
		ok = true
	}
	if ok {
		return "::" + castType.Type
	}

	return ""
}

//return default value statement for creating column
func (p *Postgres) getDefaultValueStatement(sqlType string) string {
	//get default value based on type
	if strings.Contains(sqlType, "var") || strings.Contains(sqlType, "text") {
		return "default ''"
	}

	return "default 0"
}

//Close underlying sql.DB
func (p *Postgres) Close() error {
	return p.dataSource.Close()
}

//getPrimaryKey returns primary key name and fields
func (p *Postgres) getPrimaryKey(tableName string) (string, map[string]bool, error) {
	primaryKeys := map[string]bool{}
	pkFieldsRows, err := p.dataSource.QueryContext(p.ctx, primaryKeyFieldsQuery, p.config.Schema, tableName)
	if err != nil {
		err = checkErr(err)
		return "", nil, errorj.GetPrimaryKeysError.Wrap(err, "failed to get primary key").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Schema:    p.config.Schema,
				Table:     tableName,
				Statement: primaryKeyFieldsQuery,
				Values:    []interface{}{p.config.Schema, tableName},
			})
	}

	defer pkFieldsRows.Close()
	var pkFields []string
	var primaryKeyName string
	for pkFieldsRows.Next() {
		var constraintName, keyColumn string
		if err := pkFieldsRows.Scan(&constraintName, &keyColumn); err != nil {
			return "", nil, errorj.GetPrimaryKeysError.Wrap(err, "failed to scan result").
				WithProperty(errorj.DBInfo, &ErrorPayload{
					Schema:    p.config.Schema,
					Table:     tableName,
					Statement: primaryKeyFieldsQuery,
					Values:    []interface{}{p.config.Schema, tableName},
				})
		}
		if primaryKeyName == "" && constraintName != "" {
			primaryKeyName = constraintName
		}

		pkFields = append(pkFields, keyColumn)
	}

	if err := pkFieldsRows.Err(); err != nil {
		return "", nil, errorj.GetPrimaryKeysError.Wrap(err, "failed read last row").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Schema:    p.config.Schema,
				Table:     tableName,
				Statement: primaryKeyFieldsQuery,
				Values:    []interface{}{p.config.Schema, tableName},
			})
	}

	for _, field := range pkFields {
		primaryKeys[field] = true
	}

	return primaryKeyName, primaryKeys, nil
}

//buildInsertPayload returns
// 1. column names slice
// 2. quoted column names slice
// 2. placeholders slice
// 3. values slice
func (p *Postgres) buildInsertPayload(table *Table, valuesMap map[string]interface{}) ([]string, []string, []string, []interface{}) {
	header := make([]string, len(valuesMap), len(valuesMap))
	quotedHeader := make([]string, len(valuesMap), len(valuesMap))
	placeholders := make([]string, len(valuesMap), len(valuesMap))
	values := make([]interface{}, len(valuesMap), len(valuesMap))

	columns := make([]string, 0, len(valuesMap))
	for name, _ := range valuesMap {
		columns = append(columns, name)
	}
	sort.Strings(columns)
	for i, name := range columns {
		value := valuesMap[name]
		quotedHeader[i] = fmt.Sprintf(`"%s"`, name)
		header[i] = name

		//$1::type, $2::type, $3, etc ($0 - wrong)
		placeholders[i] = fmt.Sprintf("$%d%s", i+1, p.getCastClause(name, table.Columns[name]))
		values[i] = value
	}

	return header, quotedHeader, placeholders, values
}

//buildUpdateSection returns value for merge update statement ("col1"=$1, "col2"=$2)
func (p *Postgres) buildUpdateSection(header []string) string {
	var updateColumns []string
	for i, columnName := range header {
		updateColumns = append(updateColumns, fmt.Sprintf(`"%s"=$%d`, columnName, i+1))
	}
	return strings.Join(updateColumns, ",")
}

func (p *Postgres) destinationId() interface{} {
	return p.ctx.Value(CtxDestinationId)
}

//reformatMappings handles old (deprecated) mapping types //TODO remove someday
//put sql types as is
//if mapping type is inner => map with sql type
func reformatMappings(mappingTypeCasts typing.SQLTypes, dbTypes map[typing.DataType]string) typing.SQLTypes {
	formattedSqlTypes := typing.SQLTypes{}
	for column, sqlType := range mappingTypeCasts {
		var columnType, columnStatement typing.DataType
		var err error

		columnType, err = typing.TypeFromString(sqlType.Type)
		if err != nil {
			formattedSqlTypes[column] = sqlType
			continue
		}

		columnStatement, err = typing.TypeFromString(sqlType.ColumnType)
		if err != nil {
			formattedSqlTypes[column] = sqlType
			continue
		}

		dbSQLType, _ := dbTypes[columnType]
		dbColumnType, _ := dbTypes[columnStatement]
		formattedSqlTypes[column] = typing.SQLColumn{
			Type:       dbSQLType,
			ColumnType: dbColumnType,
		}
	}

	return formattedSqlTypes
}

func removeLastComma(str string) string {
	if last := len(str) - 1; last >= 0 && str[last] == ',' {
		str = str[:last]
	}

	return str
}

//deduplicateObjects returns slices with deduplicated objects
//(two objects with the same pkFields values can't be in one slice)
func deduplicateObjects(table *Table, objects []map[string]interface{}) [][]map[string]interface{} {
	var pkFields []string
	for pkField := range table.PKFields {
		pkFields = append(pkFields, pkField)
	}

	var result [][]map[string]interface{}
	duplicatedInput := objects
	for {
		deduplicated, duplicated := getDeduplicatedAndOthers(pkFields, duplicatedInput)
		result = append(result, deduplicated)

		if len(duplicated) == 0 {
			break
		}

		duplicatedInput = duplicated
	}

	return result
}

//getDeduplicatedAndOthers returns slices with deduplicated objects and others objects
//(two objects with the same pkFields values can't be in deduplicated objects slice)
func getDeduplicatedAndOthers(pkFields []string, objects []map[string]interface{}) ([]map[string]interface{}, []map[string]interface{}) {
	var deduplicatedObjects, duplicatedObjects []map[string]interface{}
	deduplicatedIDs := map[string]bool{}

	//find duplicates
	for _, object := range objects {
		var key string
		for _, pkField := range pkFields {
			value, _ := object[pkField]
			key += fmt.Sprint(value)
		}
		if _, ok := deduplicatedIDs[key]; ok {
			duplicatedObjects = append(duplicatedObjects, object)
		} else {
			deduplicatedIDs[key] = true
			deduplicatedObjects = append(deduplicatedObjects, object)
		}
	}

	return deduplicatedObjects, duplicatedObjects
}

//checkErr checks and extracts parsed pg.Error and extract code,message,details
func checkErr(err error) error {
	if err == nil {
		return nil
	}

	if pgErr, ok := err.(*pq.Error); ok {
		msgParts := []string{"pq:"}
		if pgErr.Code != "" {
			msgParts = append(msgParts, string(pgErr.Code))
		}
		if pgErr.Message != "" {
			msgParts = append(msgParts, pgErr.Message)
		}
		if pgErr.Detail != "" {
			msgParts = append(msgParts, pgErr.Detail)
		}
		if pgErr.Schema != "" {
			msgParts = append(msgParts, "schema:"+pgErr.Schema)
		}
		if pgErr.Table != "" {
			msgParts = append(msgParts, "table:"+pgErr.Table)
		}
		if pgErr.Column != "" {
			msgParts = append(msgParts, "column:"+pgErr.Column)
		}
		if pgErr.DataTypeName != "" {
			msgParts = append(msgParts, "data_type:"+pgErr.DataTypeName)
		}
		if pgErr.Constraint != "" {
			msgParts = append(msgParts, "constraint:"+pgErr.Constraint)
		}
		return errors.New(strings.Join(msgParts, " "))
	}

	return err
}
