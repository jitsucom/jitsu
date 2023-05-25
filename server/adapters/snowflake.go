package adapters

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/server/drivers/base"
	"github.com/jitsucom/jitsu/server/errorj"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/timestamp"
	"github.com/jitsucom/jitsu/server/typing"
	"github.com/jitsucom/jitsu/server/uuid"
	sf "github.com/snowflakedb/gosnowflake"
	"math"
	"sort"
	"strings"
)

const (
	tableExistenceSFQuery   = `SELECT count(*) from INFORMATION_SCHEMA.COLUMNS where TABLE_SCHEMA = ? and TABLE_NAME = ?`
	descSchemaSFQuery       = `desc table %s.%s`
	copyStatementFileFormat = ` FILE_FORMAT=(TYPE= 'CSV', FIELD_OPTIONALLY_ENCLOSED_BY = '"' ESCAPE_UNENCLOSED_FIELD = NONE SKIP_HEADER = 1 EMPTY_FIELD_AS_NULL = true) `
	gcpFrom                 = `FROM @%s
   							   %s
                               PATTERN = '%s'`
	awsS3From = `FROM 's3://%s/%s'
					           CREDENTIALS = (aws_key_id='%s' aws_secret_key='%s') 
                               %s`

	sfMergeStatement = `MERGE INTO %s.%s USING (SELECT %s FROM %s.%s) %s ON %s WHEN MATCHED THEN UPDATE SET %s WHEN NOT MATCHED THEN INSERT (%s) VALUES (%s)`

	createSFDbSchemaIfNotExistsTemplate = `CREATE SCHEMA IF NOT EXISTS %s`
	addSFColumnTemplate                 = `ALTER TABLE %s.%s ADD COLUMN %s`
	sfRenameTableTemplate               = `ALTER TABLE %s%s.%s RENAME TO %s`
	createSFTableTemplate               = `CREATE TABLE %s.%s (%s)`
	insertSFTemplate                    = `INSERT INTO %s.%s (%s) VALUES %s`
	deleteSFTemplate                    = `DELETE FROM %s.%s WHERE %s`
	dropSFTableTemplate                 = `DROP TABLE %s%s.%s`
	truncateSFTableTemplate             = `TRUNCATE TABLE IF EXISTS %s.%s`
	updateSFTemplate                    = `UPDATE %s.%s SET %s WHERE %s = ?`

	sfMaxQueryLength = 1024 * 1024
	sfMaxPayloadSize = 16 * 1024 * 1024
)

var (
	sfReservedWords    = []string{"all", "alter", "and", "any", "as", "between", "by", "case", "cast", "check", "column", "connect", "constraint", "create", "cross", "current", "current_date", "current_time", "current_timestamp", "current_user", "delete", "distinct", "drop", "else", "exists", "false", "following", "for", "from", "full", "grant", "group", "having", "ilike", "in", "increment", "inner", "insert", "intersect", "into", "is", "join", "lateral", "left", "like", "localtime", "localtimestamp", "minus", "natural", "not", "null", "of", "on", "or", "order", "qualify", "regexp", "revoke", "right", "rlike", "row", "rows", "sample", "select", "set", "some", "start", "table", "tablesample", "then", "to", "trigger", "true", "try_cast", "union", "unique", "update", "using", "values", "when", "whenever", "where", "with"}
	sfReservedWordsSet = map[string]struct{}{}
	SchemaToSnowflake  = map[typing.DataType]string{
		typing.STRING:    "text",
		typing.INT64:     "bigint",
		typing.FLOAT64:   "double precision",
		typing.TIMESTAMP: "timestamp(6)",
		typing.BOOL:      "boolean",
		typing.UNKNOWN:   "text",
	}
)

func init() {
	for _, word := range sfReservedWords {
		sfReservedWordsSet[strings.ToUpper(word)] = struct{}{}
	}
}

// SnowflakeConfig dto for deserialized datasource config for Snowflake
type SnowflakeConfig struct {
	Account    string             `mapstructure:"account,omitempty" json:"account,omitempty" yaml:"account,omitempty"`
	Port       int                `mapstructure:"port,omitempty" json:"port,omitempty" yaml:"port,omitempty"`
	Db         string             `mapstructure:"db,omitempty" json:"db,omitempty" yaml:"db,omitempty"`
	Schema     string             `mapstructure:"schema,omitempty" json:"schema,omitempty" yaml:"schema,omitempty"`
	Username   string             `mapstructure:"username,omitempty" json:"username,omitempty" yaml:"username,omitempty"`
	Password   string             `mapstructure:"password,omitempty" json:"password,omitempty" yaml:"password,omitempty"`
	Warehouse  string             `mapstructure:"warehouse,omitempty" json:"warehouse,omitempty" yaml:"warehouse,omitempty"`
	Stage      string             `mapstructure:"stage,omitempty" json:"stage,omitempty" yaml:"stage,omitempty"`
	Parameters map[string]*string `mapstructure:"parameters,omitempty" json:"parameters,omitempty" yaml:"parameters,omitempty"`
	S3         *S3Config          `mapstructure:"s3,omitempty" json:"s3,omitempty" yaml:"s3,omitempty"`
	Google     *GoogleConfig      `mapstructure:"google,omitempty" json:"google,omitempty" yaml:"google,omitempty"`
}

// Validate required fields in SnowflakeConfig
func (sc *SnowflakeConfig) Validate() error {
	if sc == nil {
		return errors.New("Snowflake config is required")
	}
	if sc.Account == "" {
		return errors.New("Snowflake account is required parameter")
	}
	if sc.Db == "" {
		return errors.New("Snowflake db is required parameter")
	}
	if sc.Username == "" {
		return errors.New("Snowflake username is required parameter")
	}
	if sc.Warehouse == "" {
		return errors.New("Snowflake warehouse is required parameter")
	}

	if sc.Parameters == nil {
		sc.Parameters = map[string]*string{}
	}

	sc.Schema = reformatValue(sc.Schema)
	return nil
}

// Snowflake is adapter for creating,patching (schema or table), inserting data to snowflake
type Snowflake struct {
	ctx         context.Context
	config      *SnowflakeConfig
	s3Config    *S3Config
	dataSource  *sql.DB
	queryLogger *logging.QueryLogger
	sqlTypes    typing.SQLTypes
}

// NewSnowflake returns configured Snowflake adapter instance
func NewSnowflake(ctx context.Context, config *SnowflakeConfig, s3Config *S3Config,
	queryLogger *logging.QueryLogger, sqlTypes typing.SQLTypes) (*Snowflake, error) {
	cfg := &sf.Config{
		Account:   config.Account,
		User:      config.Username,
		Password:  config.Password,
		Port:      config.Port,
		Schema:    config.Schema,
		Database:  config.Db,
		Warehouse: config.Warehouse,
		Params:    config.Parameters,
	}
	connectionString, err := sf.DSN(cfg)
	if err != nil {
		return nil, err
	}

	dataSource, err := sql.Open("snowflake", connectionString)
	if err != nil {
		return nil, err
	}

	if err := dataSource.Ping(); err != nil {
		dataSource.Close()
		return nil, err
	}

	return &Snowflake{ctx: ctx, config: config, s3Config: s3Config, dataSource: dataSource, queryLogger: queryLogger, sqlTypes: reformatMappings(sqlTypes, SchemaToSnowflake)}, nil
}

func (Snowflake) Type() string {
	return "Snowflake"
}

// OpenTx open underline sql transaction and return wrapped instance
func (s *Snowflake) OpenTx() (*Transaction, error) {
	tx, err := s.dataSource.BeginTx(s.ctx, nil)
	if err != nil {
		err = checkErr(err)
		return nil, errorj.BeginTransactionError.Wrap(err, "failed to begin transaction").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Schema: s.config.Schema,
			})
	}

	return &Transaction{tx: tx, dbType: s.Type()}, nil
}

// CreateDbSchema create database schema instance if doesn't exist
func (s *Snowflake) CreateDbSchema(dbSchemaName string) error {
	query := fmt.Sprintf(createSFDbSchemaIfNotExistsTemplate, dbSchemaName)
	s.queryLogger.LogDDL(query)

	if _, err := s.dataSource.ExecContext(s.ctx, query); err != nil {
		err = checkErr(err)

		return errorj.CreateSchemaError.Wrap(err, "failed to create db schema").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Schema:    dbSchemaName,
				Statement: query,
			})
	}

	return nil
}

// CreateTable runs createTableInTransaction
func (s *Snowflake) CreateTable(table *Table) (err error) {
	wrappedTx, err := s.OpenTx()
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

	return s.createTableInTransaction(wrappedTx, table)
}

// PatchTableSchema add new columns(from provided Table) to existing table
func (s *Snowflake) PatchTableSchema(patchTable *Table) (err error) {
	wrappedTx, err := s.OpenTx()
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

	for _, columnName := range patchTable.SortedColumnNames() {
		column := patchTable.Columns[columnName]
		columnDDL := s.columnDDL(columnName, column)

		query := fmt.Sprintf(addSFColumnTemplate, s.config.Schema,
			reformatValue(patchTable.Name), columnDDL)
		s.queryLogger.LogDDL(query)

		if _, err = wrappedTx.tx.ExecContext(s.ctx, query); err != nil {
			return errorj.PatchTableError.Wrap(err, "failed to patch table").
				WithProperty(errorj.DBInfo, &ErrorPayload{
					Schema:    s.config.Schema,
					Table:     patchTable.Name,
					Statement: query,
				})
		}
	}

	return nil
}

// GetTableSchema returns table (name,columns with name and types) representation wrapped in Table struct
func (s *Snowflake) GetTableSchema(tableName string) (*Table, error) {
	table := &Table{Schema: s.config.Schema, Name: tableName, Columns: Columns{}}

	query := fmt.Sprintf(descSchemaSFQuery, reformatToParam(s.config.Schema), reformatToParam(reformatValue(tableName)))
	rows, err := s.dataSource.QueryContext(s.ctx, query)
	if err != nil {
		if strings.Contains(err.Error(), "does not exist") {
			return table, nil
		}
		return nil, errorj.GetTableError.Wrap(err, "failed to get table columns").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Schema:    s.config.Schema,
				Table:     table.Name,
				Statement: query,
			})
	}
	defer rows.Close()

	columns, err := rows.Columns()
	if err != nil {
		return nil, errorj.GetTableError.Wrap(err, "failed to get columns from the result").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Schema:    s.config.Schema,
				Table:     table.Name,
				Statement: query,
			})
	}

	for rows.Next() {
		line := make([]interface{}, len(columns))
		linePointers := make([]interface{}, len(columns))
		for i := range columns {
			linePointers[i] = &line[i]
		}

		// Scan the result into the column pointers...
		if err := rows.Scan(linePointers...); err != nil {
			return nil, errorj.GetTableError.Wrap(err, "failed to scan result").
				WithProperty(errorj.DBInfo, &ErrorPayload{
					Schema:    s.config.Schema,
					Table:     table.Name,
					Statement: query,
				})
		}

		columnName := fmt.Sprint(line[0])
		columnSnowflakeType := fmt.Sprint(line[1])

		table.Columns[strings.ToLower(columnName)] = typing.SQLColumn{Type: columnSnowflakeType}
	}
	if err := rows.Err(); err != nil {
		return nil, errorj.GetTableError.Wrap(err, "failed read last row").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Schema:    s.config.Schema,
				Table:     table.Name,
				Statement: query,
			})
	}

	return table, nil
}

// Copy transfer data from s3 to Snowflake by passing COPY request to Snowflake
func (s *Snowflake) Copy(fileName, tableName string, header []string) error {
	var reformattedHeader []string
	for _, v := range header {
		reformattedHeader = append(reformattedHeader, reformatValue(v))
	}

	statement := fmt.Sprintf(`COPY INTO %s.%s (%s) `, s.config.Schema, reformatValue(tableName), strings.Join(reformattedHeader, ","))
	maskedCredentialsStatement := statement
	if s.s3Config != nil {
		//s3 integration stage
		if s.s3Config.Folder != "" {
			fileName = s.s3Config.Folder + "/" + fileName
		}
		statement += fmt.Sprintf(awsS3From, s.s3Config.Bucket, fileName, s.s3Config.AccessKeyID, s.s3Config.SecretKey, copyStatementFileFormat)
		maskedCredentialsStatement += fmt.Sprintf(awsS3From, s.s3Config.Bucket, fileName, credentialsMask, credentialsMask, copyStatementFileFormat)
	} else {
		//gcp integration stage
		statement += fmt.Sprintf(gcpFrom, s.config.Stage, copyStatementFileFormat, fileName)
		maskedCredentialsStatement += fmt.Sprintf(gcpFrom, s.config.Stage, copyStatementFileFormat, fileName)
	}

	if _, err := s.dataSource.ExecContext(s.ctx, statement); err != nil {
		return errorj.CopyError.Wrap(err, "failed to copy data from stage").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Schema:    s.config.Schema,
				Table:     tableName,
				Statement: maskedCredentialsStatement,
			})
	}

	return nil
}

// Insert inserts data with InsertContext as a single object or a batch into Snowflake
func (s *Snowflake) Insert(insertContext *InsertContext) error {
	if insertContext.eventContext != nil {
		return s.insertSingle(insertContext.eventContext)
	} else {
		return s.insertBatch(insertContext.table, insertContext.objects, insertContext.deleteConditions)
	}
}

// insertSingle inserts provided object into Snowflake
func (s *Snowflake) insertSingle(eventContext *EventContext) error {
	var columnNames, placeholders []string
	var values []interface{}
	columns := make([]string, 0, len(eventContext.ProcessedEvent))
	for name, _ := range eventContext.ProcessedEvent {
		columns = append(columns, name)
	}
	sort.Strings(columns)
	for _, name := range columns {
		value := eventContext.ProcessedEvent[name]
		columnNames = append(columnNames, reformatValue(name))

		castClause := s.getCastClause(name, eventContext.Table.Columns[name])
		placeholders = append(placeholders, "?"+castClause)
		values = append(values, value)
	}

	header := strings.Join(columnNames, ", ")
	placeholderStr := strings.Join(placeholders, ", ")

	statement := fmt.Sprintf(insertSFTemplate, s.config.Schema, reformatValue(eventContext.Table.Name), header, "("+placeholderStr+")")
	s.queryLogger.LogQueryWithValues(statement, values)

	_, err := s.dataSource.ExecContext(s.ctx, statement, values...)
	if err != nil {
		return errorj.ExecuteInsertError.Wrap(err, "failed to execute single insert").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Schema:      s.config.Schema,
				Table:       eventContext.Table.Name,
				PrimaryKeys: eventContext.Table.GetPKFields(),
				Statement:   statement,
				Values:      values,
			})
	}

	return nil
}

// insertBatch deletes with deleteConditions and runs bulkMergeInTransaction
func (s *Snowflake) insertBatch(table *Table, objects []map[string]interface{}, deleteConditions *base.DeleteConditions) (err error) {
	wrappedTx, err := s.OpenTx()
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
		if err = s.deleteInTransaction(wrappedTx, table, deleteConditions); err != nil {
			return err
		}
	}

	if len(table.PKFields) == 0 {
		return s.bulkInsertInTransaction(wrappedTx, table, objects)
	}

	//deduplication for bulkMerge success (it fails if there is any duplicate)
	deduplicatedObjectsBuckets := deduplicateObjects(table, objects)

	for _, objectsBucket := range deduplicatedObjectsBuckets {
		if err = s.bulkMergeInTransaction(wrappedTx, table, objectsBucket); err != nil {
			return err
		}
	}

	return nil
}

// DropTable drops table in transaction
func (s *Snowflake) DropTable(table *Table) (err error) {
	wrappedTx, err := s.OpenTx()
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

	return s.dropTableInTransaction(wrappedTx, table, false)
}

func (s *Snowflake) ReplaceTable(originalTable, replacementTable string, dropOldTable bool) (err error) {
	wrappedTx, err := s.OpenTx()
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
	tmpTable := "deprecated_" + originalTable + timestamp.Now().Format("_20060102_150405")
	err1 := s.renameTableInTransaction(wrappedTx, true, originalTable, tmpTable)
	err = s.renameTableInTransaction(wrappedTx, false, replacementTable, originalTable)
	if dropOldTable && err1 == nil && err == nil {
		return s.dropTableInTransaction(wrappedTx, &Table{Name: tmpTable}, true)
	}
	return
}

// Truncate deletes all records in tableName table
func (s *Snowflake) Truncate(tableName string) error {
	sqlParams := SqlParams{
		dataSource:  s.dataSource,
		queryLogger: s.queryLogger,
		ctx:         s.ctx,
	}
	statement := fmt.Sprintf(truncateSFTableTemplate, s.config.Db, tableName)
	if err := sqlParams.commonTruncate(statement); err != nil {
		return errorj.TruncateError.Wrap(err, "failed to truncate table").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Schema:    s.config.Schema,
				Table:     tableName,
				Statement: statement,
			})
	}

	return nil
}

// Update one record in Snowflake
func (s *Snowflake) Update(table *Table, object map[string]interface{}, whereKey string, whereValue interface{}) error {
	columnNames := make([]string, len(object), len(object))
	values := make([]interface{}, len(object)+1, len(object)+1)

	columns := make([]string, 0, len(object))
	for name, _ := range object {
		columns = append(columns, name)
	}
	sort.Strings(columns)

	for i, name := range columns {
		value := object[name]
		castClause := s.getCastClause(name, table.Columns[name])
		columnNames[i] = reformatValue(name) + "= ?" + castClause
		values[i] = value
	}
	values[len(values)-1] = whereValue

	header := strings.Join(columnNames, ", ")

	statement := fmt.Sprintf(updateSFTemplate, s.config.Schema, reformatValue(table.Name), header, reformatValue(whereKey))
	s.queryLogger.LogQueryWithValues(statement, values)

	_, err := s.dataSource.ExecContext(s.ctx, statement, values...)
	if err != nil {
		return fmt.Errorf("Error updating in %s table with statement: %s values: %v: %v", table.Name, header, values, err)
	}

	return nil
}

// createTableInTransaction creates database table with name,columns provided in Table representation
func (s *Snowflake) createTableInTransaction(wrappedTx *Transaction, table *Table) error {
	var columnsDDL []string
	for _, columnName := range table.SortedColumnNames() {
		column := table.Columns[columnName]
		columnDDL := s.columnDDL(columnName, column)
		columnsDDL = append(columnsDDL, columnDDL)
	}

	//sorting columns asc
	sort.Strings(columnsDDL)
	query := fmt.Sprintf(createSFTableTemplate, s.config.Schema, reformatValue(table.Name), strings.Join(columnsDDL, ","))
	s.queryLogger.LogDDL(query)

	_, err := wrappedTx.tx.ExecContext(s.ctx, query)
	if err != nil {
		return fmt.Errorf("Error creating [%s] table with statement [%s]: %v", table.Name, query, err)
	}

	return nil
}

// bulkInsertInTransaction inserts events in batches (insert into values (),(),())
func (s *Snowflake) bulkInsertInTransaction(wrappedTx *Transaction, table *Table, objects []map[string]interface{}) error {
	var placeholdersBuilder strings.Builder
	var unformattedColumnNames []string
	for _, name := range table.SortedColumnNames() {
		unformattedColumnNames = append(unformattedColumnNames, name)
	}
	valuesAmount := len(objects) * len(table.Columns)
	maxValues := valuesAmount
	if maxValues > PostgresValuesLimit {
		maxValues = PostgresValuesLimit
	}
	valueArgs := make([]interface{}, 0, maxValues)
	operation := 0
	operations := int(math.Max(1, float64(valuesAmount)/float64(PostgresValuesLimit)))
	queryBaseLength := len(fmt.Sprintf(insertSFTemplate, s.config.Schema, table.Name, strings.Join(unformattedColumnNames, "','"), ""))
	estimatedPayloadSize := 0
	for _, row := range objects {
		// if number of values exceeds limit, we have to execute insert query on processed rows
		if len(valueArgs)+len(unformattedColumnNames) > PostgresValuesLimit ||
			placeholdersBuilder.Len()+queryBaseLength >= sfMaxQueryLength ||
			estimatedPayloadSize >= sfMaxPayloadSize {
			operation++
			if err := s.executeInsertInTransaction(wrappedTx, table, unformattedColumnNames, removeLastComma(placeholdersBuilder.String()), valueArgs); err != nil {
				return errorj.Decorate(err, "middle insert %d of %d in batch", operation, operations)
			}

			placeholdersBuilder.Reset()
			estimatedPayloadSize = 0
			valueArgs = make([]interface{}, 0, maxValues)
		}
		_, _ = placeholdersBuilder.WriteString("(")

		for i, column := range unformattedColumnNames {
			value, _ := row[column]
			//trying to estimate payload size to avoid exceeding max payload size 16Mb: https://docs.snowflake.com/en/developer-guide/node-js/nodejs-driver-execute
			//adding 4 bytes to each parameter size just in case (e.g.: to account for the length of the parameters or other extra unfi)
			estimatedPayloadSize += 4 + len(fmt.Sprint(value))
			valueArgs = append(valueArgs, value)
			castClause := s.getCastClause(column, table.Columns[column])

			_, _ = placeholdersBuilder.WriteString("?" + castClause)

			if i < len(unformattedColumnNames)-1 {
				_, _ = placeholdersBuilder.WriteString(",")
			}
		}
		_, _ = placeholdersBuilder.WriteString("),")
	}
	if len(valueArgs) > 0 {
		operation++
		err := s.executeInsertInTransaction(wrappedTx, table, unformattedColumnNames, removeLastComma(placeholdersBuilder.String()), valueArgs)
		if err != nil {
			return errorj.Decorate(err, "last insert %d of %d in batch", operation, operations)
		}
	}

	return nil
}

// bulkMergeInTransaction uses temporary table and insert from select statement
func (s *Snowflake) bulkMergeInTransaction(wrappedTx *Transaction, table *Table, objects []map[string]interface{}) error {
	tmpTable := &Table{
		Name:           fmt.Sprintf("jitsu_tmp_%s", uuid.NewLettersNumbers()[:5]),
		Columns:        table.Columns,
		PKFields:       map[string]bool{},
		DeletePkFields: false,
	}

	err := s.createTableInTransaction(wrappedTx, tmpTable)
	if err != nil {
		return errorj.Decorate(err, "failed to create temporary table")
	}

	defer func() {
		//delete tmp table
		if err := s.dropTableInTransaction(wrappedTx, tmpTable, false); err != nil {
			logging.Warnf("[snowflake] Failed to drop temporary table '%s': %v", tmpTable.Name, err)
		}
	}()

	err = s.bulkInsertInTransaction(wrappedTx, tmpTable, objects)
	if err != nil {
		return errorj.Decorate(err, "failed to insert into temporary table").
			WithProperty(errorj.DBObjects, dbObjects(objects))
	}

	//insert from select
	var unformattedColumnNames []string
	var formattedColumnNames []string
	var updateSet []string
	var tmpPreffixColumnNames []string
	for _, name := range table.SortedColumnNames() {
		reformattedColumnName := reformatValue(name)
		unformattedColumnNames = append(unformattedColumnNames, name)
		formattedColumnNames = append(formattedColumnNames, reformatDefault(reformattedColumnName))
		updateSet = append(updateSet, fmt.Sprintf("%s.%s = %s.%s", table.Name, reformattedColumnName, tmpTable.Name, reformattedColumnName))
		tmpPreffixColumnNames = append(tmpPreffixColumnNames, fmt.Sprintf("%s.%s", tmpTable.Name, reformattedColumnName))
	}

	var joinConditions []string
	for pkField := range table.PKFields {
		joinConditions = append(joinConditions, fmt.Sprintf("%s.%s = %s.%s", table.Name, pkField, tmpTable.Name, pkField))
	}

	insertFromSelectStatement := fmt.Sprintf(sfMergeStatement, s.config.Schema, table.Name, strings.Join(formattedColumnNames, ", "), s.config.Schema, tmpTable.Name,
		tmpTable.Name, strings.Join(joinConditions, " AND "), strings.Join(updateSet, ", "), strings.Join(formattedColumnNames, ", "), strings.Join(tmpPreffixColumnNames, ", "))

	s.queryLogger.LogQuery(insertFromSelectStatement)
	if _, err = wrappedTx.tx.ExecContext(s.ctx, insertFromSelectStatement); err != nil {

		return errorj.BulkMergeError.Wrap(err, "failed to bulk merge").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Schema:    s.config.Schema,
				Table:     table.Name,
				Statement: insertFromSelectStatement,
			})
	}

	return nil
}

type dbObjects []map[string]interface{}

func (o dbObjects) String() string {
	if len(o) == 0 {
		return "[]"
	}

	var b strings.Builder
	b.WriteRune('[')
	for i, object := range o {
		if i < 2000 {
			data, _ := json.Marshal(object)
			b.WriteString("\n  " + string(data) + ",")
		} else {
			b.WriteString(fmt.Sprintf("\n  // ... omitted %d objects ...", len(o)-i))
			break
		}
	}

	b.WriteString("\n]")
	return b.String()
}

// dropTableInTransaction drops a table in transaction
func (s *Snowflake) dropTableInTransaction(wrappedTx *Transaction, table *Table, ifExists bool) error {
	ifExs := ""
	if ifExists {
		ifExs = "IF EXISTS "
	}
	query := fmt.Sprintf(dropSFTableTemplate, ifExs, s.config.Schema, table.Name)
	s.queryLogger.LogDDL(query)

	if _, err := wrappedTx.tx.ExecContext(s.ctx, query); err != nil {
		return errorj.DropError.Wrap(err, "failed to drop table").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Schema:    s.config.Schema,
				Table:     table.Name,
				Statement: query,
			})
	}

	return nil
}

func (s *Snowflake) renameTableInTransaction(wrappedTx *Transaction, ifExists bool, tableName, newTableName string) error {
	ifExs := ""
	if ifExists {
		ifExs = "IF EXISTS "
	}
	query := fmt.Sprintf(sfRenameTableTemplate, ifExs, s.config.Schema, tableName, newTableName)
	s.queryLogger.LogDDL(query)

	if _, err := wrappedTx.tx.ExecContext(s.ctx, query); err != nil {
		return errorj.RenameError.Wrap(err, "failed to rename table").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Schema:    s.config.Schema,
				Table:     tableName,
				Statement: query,
			})
	}

	return nil
}

// executeInsertInTransaction execute insert with insertTemplate
func (s *Snowflake) executeInsertInTransaction(wrappedTx *Transaction, table *Table, headerWithoutQuotes []string, placeholders string, valueArgs []interface{}) error {
	var quotedHeader []string
	for _, columnName := range headerWithoutQuotes {
		quotedHeader = append(quotedHeader, reformatValue(columnName))
	}

	statement := fmt.Sprintf(insertSFTemplate, s.config.Schema, table.Name, strings.Join(quotedHeader, ","), placeholders)

	s.queryLogger.LogQueryWithValues(statement, valueArgs)

	if _, err := wrappedTx.tx.Exec(statement, valueArgs...); err != nil {
		return errorj.ExecuteInsertInBatchError.Wrap(err, "failed to execute insert").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Schema:          s.config.Schema,
				Table:           table.Name,
				Statement:       statement,
				ValuesMapString: ObjectValuesToString(headerWithoutQuotes, valueArgs),
			})
	}

	return nil
}

// deleteInTransaction deletes objects from Snowflake in transaction
func (s *Snowflake) deleteInTransaction(wrappedTx *Transaction, table *Table, deleteConditions *base.DeleteConditions) error {
	deleteCondition, values := s.toDeleteQuery(deleteConditions)
	query := fmt.Sprintf(deleteSFTemplate, s.config.Schema, reformatValue(table.Name), deleteCondition)
	s.queryLogger.LogQueryWithValues(query, values)

	_, err := wrappedTx.tx.ExecContext(s.ctx, query, values...)
	if err != nil {
		return errorj.DeleteFromTableError.Wrap(err, "failed to delete data").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Schema:    s.config.Schema,
				Table:     table.Name,
				Statement: query,
			})
	}

	return nil
}

func (s *Snowflake) toDeleteQuery(conditions *base.DeleteConditions) (string, []interface{}) {
	var queryConditions []string
	var values []interface{}

	for _, condition := range conditions.Conditions {
		conditionString := condition.Field + " " + condition.Clause + " ?"
		queryConditions = append(queryConditions, conditionString)
		values = append(values, typing.ReformatValue(condition.Value))
	}

	return strings.Join(queryConditions, " "+conditions.JoinCondition+" "), values
}

// Close underlying sql.DB
func (s *Snowflake) Close() (multiErr error) {
	return s.dataSource.Close()
}

// getCastClause returns ::SQL_TYPE clause or empty string
// $1::type, $2::type, $3, etc
func (s *Snowflake) getCastClause(name string, column typing.SQLColumn) string {
	castType, ok := s.sqlTypes[name]
	if !ok && column.Override {
		castType = column
		ok = true
	}
	if ok {
		return "::" + castType.Type
	}

	return ""
}

// columnDDL returns column DDL (column name, mapped sql type)
func (s *Snowflake) columnDDL(name string, column typing.SQLColumn) string {
	sqlColumnTypeDDL := column.DDLType()
	overriddenSQLType, ok := s.sqlTypes[name]
	if ok {
		sqlColumnTypeDDL = overriddenSQLType.ColumnType
	}

	return fmt.Sprintf(`%s %s`, reformatValue(name), sqlColumnTypeDDL)
}

// Snowflake has table with schema, table names and there
// quoted identifiers = without quotes
// unquoted identifiers = uppercased
func reformatToParam(value string) string {
	if strings.Contains(value, `"`) {
		return strings.ReplaceAll(value, `"`, ``)
	} else {
		return strings.ToUpper(value)
	}
}

// Snowflake accepts names (identifiers) started with '_' or letter
// also names can contain only '_', letters, numbers, '$'
// otherwise double quote them
// https://docs.snowflake.com/en/sql-reference/identifiers-syntax.html#unquoted-identifiers
func reformatValue(value string) string {
	if len(value) > 0 {
		//must begin with a letter or underscore, or enclose in double quotes
		firstSymbol := value[0]

		if isNotLetterOrUnderscore(int32(firstSymbol)) {
			return `"` + value + `"`
		}

		for _, symbol := range value {
			if isNotLetterOrUnderscore(symbol) && isNotNumberOrDollar(symbol) {
				return `"` + value + `"`
			}
		}

		upper := strings.ToUpper(value)
		if _, ok := sfReservedWordsSet[upper]; ok {
			return `"` + upper + `"`
		}

	}

	return value
}

// Snowflake doesn't accept names (identifiers) like: default
// it should be reformatted to "DEFAULT"
func reformatDefault(value string) string {
	if value == "default" {
		return `"DEFAULT"`
	}

	return value
}

// _: 95
// A - Z: 65-90
// a - z: 97-122
func isNotLetterOrUnderscore(symbol int32) bool {
	return symbol < 65 || (symbol != 95 && symbol > 90 && symbol < 97) || symbol > 122
}

// $: 36
// 0 - 9: 48-57
func isNotNumberOrDollar(symbol int32) bool {
	return symbol != 36 && (symbol < 48 || symbol > 57)
}
