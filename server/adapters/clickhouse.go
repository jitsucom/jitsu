package adapters

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"database/sql"
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/typing"
	"github.com/mailru/go-clickhouse"
	"io/ioutil"
	"sort"
	"strings"
	"time"
)

const (
	tableSchemaCHQuery        = `SELECT name, type FROM system.columns WHERE database = ? and table = ?`
	createCHDBTemplate        = `CREATE DATABASE IF NOT EXISTS "%s" %s`
	addColumnCHTemplate       = `ALTER TABLE "%s"."%s" %s ADD COLUMN %s`
	insertCHTemplate          = `INSERT INTO "%s"."%s" (%s) VALUES (%s)`
	deleteQueryChTemplate     = `ALTER TABLE %s.%s DELETE WHERE %s`
	dropTableCHTemplate       = `DROP TABLE "%s"."%s"`
	onClusterCHClauseTemplate = ` ON CLUSTER "%s" `
	columnCHNullableTemplate  = ` Nullable(%s) `

	createTableCHTemplate            = `CREATE TABLE "%s"."%s" %s (%s) %s %s %s %s`
	createDistributedTableCHTemplate = `CREATE TABLE "%s"."dist_%s" %s AS "%s"."%s" ENGINE = Distributed(%s,%s,%s,rand())`
	dropDistributedTableCHTemplate   = `DROP TABLE IF EXISTS "%s"."dist_%s" %s`

	defaultPartition  = `PARTITION BY (toYYYYMM(_timestamp))`
	defaultOrderBy    = `ORDER BY (eventn_ctx_event_id)`
	defaultPrimaryKey = ``
)

var (
	SchemaToClickhouse = map[typing.DataType]string{
		typing.STRING:    "String",
		typing.INT64:     "Int64",
		typing.FLOAT64:   "Float64",
		typing.TIMESTAMP: "DateTime",
		typing.BOOL:      "UInt8",
		typing.UNKNOWN:   "String",
	}

	defaultValues = map[string]interface{}{
		"int8":                     0,
		"int32":                    0,
		"int64":                    0,
		"int128":                   0,
		"int256":                   0,
		"float32":                  0.0,
		"float64":                  0.0,
		"decimal":                  0.0,
		"numeric":                  0.0,
		"datetime":                 time.Time{},
		"uint8":                    false,
		"uint32":                   0,
		"uint64":                   0,
		"uint128":                  0,
		"uint256":                  0,
		"string":                   "",
		"lowcardinality(int32)":    0,
		"lowcardinality(int64)":    0,
		"lowcardinality(float32)":  0,
		"lowcardinality(float64)":  0,
		"lowcardinality(datetime)": time.Time{},
		"lowcardinality(uint8)":    false,
		"lowcardinality(string)":   "",
	}
)

//ClickHouseConfig dto for deserialized clickhouse config
type ClickHouseConfig struct {
	Dsns     []string          `mapstructure:"dsns" json:"dsns,omitempty" yaml:"dsns,omitempty"`
	Database string            `mapstructure:"db" json:"db,omitempty" yaml:"db,omitempty"`
	TLS      map[string]string `mapstructure:"tls" json:"tls,omitempty" yaml:"tls,omitempty"`
	Cluster  string            `mapstructure:"cluster" json:"cluster,omitempty" yaml:"cluster,omitempty"`
	Engine   *EngineConfig     `mapstructure:"engine" json:"engine,omitempty" yaml:"engine,omitempty"`
}

//EngineConfig dto for deserialized clickhouse engine config
type EngineConfig struct {
	RawStatement    string        `mapstructure:"raw_statement" json:"raw_statement,omitempty" yaml:"raw_statement,omitempty"`
	NullableFields  []string      `mapstructure:"nullable_fields" json:"nullable_fields,omitempty" yaml:"nullable_fields,omitempty"`
	PartitionFields []FieldConfig `mapstructure:"partition_fields" json:"partition_fields,omitempty" yaml:"partition_fields,omitempty"`
	OrderFields     []FieldConfig `mapstructure:"order_fields" json:"order_fields,omitempty" yaml:"order_fields,omitempty"`
	PrimaryKeys     []string      `mapstructure:"primary_keys" json:"primary_keys,omitempty" yaml:"primary_keys,omitempty"`
}

//FieldConfig dto for deserialized clickhouse engine fields
type FieldConfig struct {
	Function string `mapstructure:"function" json:"function,omitempty" yaml:"function,omitempty"`
	Field    string `mapstructure:"field" json:"field,omitempty" yaml:"field,omitempty"`
}

//Validate required fields in ClickHouseConfig
func (chc *ClickHouseConfig) Validate() error {
	if chc == nil {
		return errors.New("ClickHouse config is required")
	}

	if len(chc.Dsns) == 0 {
		return errors.New("dsn is required parameter")
	}

	for _, dsn := range chc.Dsns {
		if !strings.HasPrefix(dsn, "http") {
			return errors.New("DSNs must have http:// or https:// prefix")
		}
	}

	if chc.Cluster == "" && len(chc.Dsns) > 1 {
		return errors.New("cluster is required parameter when dsns count > 1")
	}

	if chc.Database == "" {
		return errors.New("db is required parameter")
	}

	return nil
}

//TableStatementFactory is used for creating CREATE TABLE statements depends on config
type TableStatementFactory struct {
	engineStatement string
	database        string
	onClusterClause string

	partitionClause  string
	orderByClause    string
	primaryKeyClause string

	engineStatementFormat bool
}

func NewTableStatementFactory(config *ClickHouseConfig) (*TableStatementFactory, error) {
	if config == nil {
		return nil, errors.New("Clickhouse config can't be nil")
	}
	var onClusterClause string
	if config.Cluster != "" {
		onClusterClause = fmt.Sprintf(onClusterCHClauseTemplate, config.Cluster)
	}

	partitionClause := defaultPartition
	orderByClause := defaultOrderBy
	primaryKeyClause := defaultPrimaryKey
	if config.Engine != nil {
		//raw statement overrides all provided config parameters
		if config.Engine.RawStatement != "" {
			return &TableStatementFactory{
				engineStatement: config.Engine.RawStatement,
				database:        config.Database,
				onClusterClause: onClusterClause,
			}, nil
		}

		if len(config.Engine.PartitionFields) > 0 {
			partitionClause = "PARTITION BY (" + extractStatement(config.Engine.PartitionFields) + ")"
		}
		if len(config.Engine.OrderFields) > 0 {
			orderByClause = "ORDER BY (" + extractStatement(config.Engine.OrderFields) + ")"
		}
		if len(config.Engine.PrimaryKeys) > 0 {
			primaryKeyClause = "PRIMARY KEY (" + strings.Join(config.Engine.PrimaryKeys, ", ") + ")"
		}
	}

	var engineStatement string
	var engineStatementFormat bool
	if config.Cluster != "" {
		//create engine statement with ReplicatedReplacingMergeTree() engine. We need to replace %s with tableName on creating statement
		engineStatement = `ENGINE = ReplicatedReplacingMergeTree('/clickhouse/tables/{shard}/` + config.Database + `/%s', '{replica}', _timestamp)`
		engineStatementFormat = true
	} else {
		//create table template with ReplacingMergeTree() engine
		engineStatement = `ENGINE = ReplacingMergeTree(_timestamp)`
	}

	return &TableStatementFactory{
		engineStatement:       engineStatement,
		database:              config.Database,
		onClusterClause:       onClusterClause,
		partitionClause:       partitionClause,
		orderByClause:         orderByClause,
		primaryKeyClause:      primaryKeyClause,
		engineStatementFormat: engineStatementFormat,
	}, nil
}

//CreateTableStatement return clickhouse DDL for creating table statement
func (tsf TableStatementFactory) CreateTableStatement(tableName, columnsClause string) string {
	engineStatement := tsf.engineStatement
	if tsf.engineStatementFormat {
		engineStatement = fmt.Sprintf(engineStatement, tableName)
	}
	return fmt.Sprintf(createTableCHTemplate, tsf.database, tableName, tsf.onClusterClause, columnsClause, engineStatement,
		tsf.partitionClause, tsf.orderByClause, tsf.primaryKeyClause)
}

//ClickHouse is adapter for creating,patching (schema or table), inserting data to clickhouse
type ClickHouse struct {
	ctx                   context.Context
	database              string
	cluster               string
	dataSource            *sql.DB
	tableStatementFactory *TableStatementFactory
	nullableFields        map[string]bool
	queryLogger           *logging.QueryLogger
	sqlTypes              typing.SQLTypes
}

//NewClickHouse returns configured ClickHouse adapter instance
func NewClickHouse(ctx context.Context, connectionString, database, cluster string, tlsConfig map[string]string,
	tableStatementFactory *TableStatementFactory, nullableFields map[string]bool,
	queryLogger *logging.QueryLogger, sqlTypes typing.SQLTypes) (*ClickHouse, error) {
	connectionString = strings.TrimSpace(connectionString)
	//configure tls
	if strings.Contains(connectionString, "https://") && tlsConfig != nil {
		for tlsName, crtPath := range tlsConfig {
			caCert, err := ioutil.ReadFile(crtPath)
			if err != nil {
				return nil, err
			}

			caCertPool := x509.NewCertPool()
			caCertPool.AppendCertsFromPEM(caCert)
			if err := clickhouse.RegisterTLSConfig(tlsName, &tls.Config{RootCAs: caCertPool}); err != nil {
				return nil, err
			}
		}
	}

	//enrich with ?wait_end_of_query=1 (for waiting on cluster execution result)
	if strings.Contains(connectionString, "?") {
		connectionString += "&"
	} else {
		connectionString += "?"
	}

	connectionString += "wait_end_of_query=1"
	//connect
	dataSource, err := sql.Open("clickhouse", connectionString)
	if err != nil {
		return nil, err
	}

	//keep select 1 and don't use Ping() because chproxy doesn't support /ping endpoint.
	if _, err := dataSource.Exec("SELECT 1"); err != nil {
		dataSource.Close()
		return nil, err
	}

	return &ClickHouse{
		ctx:                   ctx,
		database:              database,
		cluster:               cluster,
		dataSource:            dataSource,
		tableStatementFactory: tableStatementFactory,
		nullableFields:        nullableFields,
		queryLogger:           queryLogger,
		sqlTypes:              reformatMappings(sqlTypes, SchemaToClickhouse),
	}, nil
}

func (ClickHouse) Type() string {
	return "ClickHouse"
}

//OpenTx open underline sql transaction and return wrapped instance
func (ch *ClickHouse) OpenTx() (*Transaction, error) {
	tx, err := ch.dataSource.BeginTx(ch.ctx, nil)
	if err != nil {
		return nil, err
	}

	return &Transaction{tx: tx, dbType: ch.Type()}, nil
}

//CreateDB create database instance if doesn't exist
func (ch *ClickHouse) CreateDB(dbName string) error {
	wrappedTx, err := ch.OpenTx()
	if err != nil {
		return err
	}

	query := fmt.Sprintf(createCHDBTemplate, dbName, ch.getOnClusterClause())
	ch.queryLogger.LogDDL(query)
	_, err = wrappedTx.tx.ExecContext(ch.ctx, query)
	if err != nil {
		return fmt.Errorf("Error creating [%s] db with statement [%s]: %v", dbName, query, err)
	}

	return wrappedTx.tx.Commit()
}

//CreateTable create database table with name,columns provided in Table representation
//New tables will have MergeTree() or ReplicatedMergeTree() engine depends on config.cluster empty or not
func (ch *ClickHouse) CreateTable(tableSchema *Table) error {
	var columnsDDL []string
	for columnName, column := range tableSchema.Columns {
		columnTypeDDL := ch.columnDDL(columnName, column)
		columnsDDL = append(columnsDDL, columnTypeDDL)
	}

	//sorting columns asc
	sort.Strings(columnsDDL)
	statementStr := ch.tableStatementFactory.CreateTableStatement(tableSchema.Name, strings.Join(columnsDDL, ","))
	ch.queryLogger.LogDDL(statementStr)

	_, err := ch.dataSource.ExecContext(ch.ctx, statementStr)
	if err != nil {
		return fmt.Errorf("Error creating table [%s] statement [%s]: %v", tableSchema.Name, statementStr, err)
	}

	//create distributed table if ReplicatedMergeTree engine
	if ch.cluster != "" {
		ch.createDistributedTableInTransaction(tableSchema.Name)
	}

	return nil
}

//GetTableSchema return table (name,columns with name and types) representation wrapped in Table struct
func (ch *ClickHouse) GetTableSchema(tableName string) (*Table, error) {
	table := &Table{Name: tableName, Columns: map[string]Column{}}
	rows, err := ch.dataSource.QueryContext(ch.ctx, tableSchemaCHQuery, ch.database, tableName)
	if err != nil {
		return nil, fmt.Errorf("Error querying table [%s] schema: %v", tableName, err)
	}

	defer rows.Close()
	for rows.Next() {
		var columnName, columnClickhouseType string
		if err := rows.Scan(&columnName, &columnClickhouseType); err != nil {
			return nil, fmt.Errorf("Error scanning result: %v", err)
		}

		table.Columns[columnName] = Column{SQLType: columnClickhouseType}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("Last rows.Err: %v", err)
	}

	return table, nil
}

//PatchTableSchema add new columns(from provided Table) to existing table
//drop and create distributed table
func (ch *ClickHouse) PatchTableSchema(patchSchema *Table) error {
	wrappedTx, err := ch.OpenTx()
	if err != nil {
		return err
	}

	for columnName, column := range patchSchema.Columns {
		columnDDL := ch.columnDDL(columnName, column)
		query := fmt.Sprintf(addColumnCHTemplate, ch.database, patchSchema.Name, ch.getOnClusterClause(), columnDDL)
		ch.queryLogger.LogDDL(query)

		_, err := wrappedTx.tx.ExecContext(ch.ctx, query)
		if err != nil {
			wrappedTx.Rollback()
			return fmt.Errorf("Error patching %s table with statement [%s]: %v", patchSchema.Name, query, err)
		}
	}

	//drop and create distributed table if ReplicatedMergeTree engine
	if ch.cluster != "" {
		ch.dropDistributedTableInTransaction(wrappedTx, patchSchema.Name)
		ch.createDistributedTableInTransaction(patchSchema.Name)
	}

	return wrappedTx.tx.Commit()
}

//Insert provided object in ClickHouse in stream mode
func (ch *ClickHouse) Insert(eventContext *EventContext) error {
	var headerWithQuotes, placeholders []string
	var values []interface{}
	for name, value := range eventContext.ProcessedEvent {
		headerWithQuotes = append(headerWithQuotes, fmt.Sprintf(`"%s"`, name))
		placeholders = append(placeholders, ch.getPlaceholder(name))
		values = append(values, value)
	}

	wrappedTx, err := ch.OpenTx()
	if err != nil {
		return err
	}

	query := fmt.Sprintf(insertCHTemplate, ch.database, eventContext.Table.Name, strings.Join(headerWithQuotes, ", "), strings.Join(placeholders, ", "))
	ch.queryLogger.LogQueryWithValues(query, values)

	_, err = wrappedTx.tx.ExecContext(ch.ctx, query, values...)
	if err != nil {
		wrappedTx.Rollback()
		return fmt.Errorf("Error inserting in %s table with statement: %s values: %v: %v", eventContext.Table.Name, query, values, err)
	}

	return wrappedTx.DirectCommit()
}

func (ch *ClickHouse) BulkUpdate(table *Table, objects []map[string]interface{}, deleteConditions *DeleteConditions) error {
	wrappedTx, err := ch.OpenTx()
	if err != nil {
		return err
	}

	if !deleteConditions.IsEmpty() {
		err := ch.deleteInTransaction(wrappedTx, table, deleteConditions)
		if err != nil {
			wrappedTx.Rollback()
			return err
		}
	}

	if err := ch.insertInTransaction(wrappedTx, table, objects); err != nil {
		wrappedTx.Rollback()
		return err
	}
	return wrappedTx.DirectCommit()
}

func (ch *ClickHouse) deleteInTransaction(wrappedTx *Transaction, table *Table, deleteConditions *DeleteConditions) error {
	deleteCondition, values := ch.toDeleteQuery(deleteConditions)
	deleteQuery := fmt.Sprintf(deleteQueryChTemplate, ch.database, table.Name, deleteCondition)

	ch.queryLogger.LogQueryWithValues(deleteQuery, values)

	_, err := wrappedTx.tx.ExecContext(ch.ctx, deleteQuery, values...)
	if err != nil {
		return fmt.Errorf("Error deleting using query: %s, error: %v", deleteQuery, err)
	}

	return nil
}

//BulkInsert insert objects into table in one prepared statement
func (ch *ClickHouse) BulkInsert(table *Table, objects []map[string]interface{}) error {
	wrappedTx, err := ch.OpenTx()
	err = ch.insertInTransaction(wrappedTx, table, objects)
	if err != nil {
		wrappedTx.Rollback()
		return err
	}
	return wrappedTx.DirectCommit()
}

//DropTable drops table in transaction
func (ch *ClickHouse) DropTable(table *Table) error {
	wrappedTx, err := ch.OpenTx()
	if err != nil {
		return err
	}

	query := fmt.Sprintf(dropTableCHTemplate, ch.database, table.Name)
	ch.queryLogger.LogDDL(query)

	_, err = wrappedTx.tx.ExecContext(ch.ctx, query)

	if err != nil {
		return fmt.Errorf("Error dropping [%s] table: %v", table.Name, err)
	}

	if ch.cluster != "" {
		ch.dropDistributedTableInTransaction(wrappedTx, table.Name)
	}

	return nil
}

func (ch *ClickHouse) toDeleteQuery(conditions *DeleteConditions) (string, []interface{}) {
	var queryConditions []string
	var values []interface{}
	for _, condition := range conditions.Conditions {
		queryConditions = append(queryConditions, condition.Field+" "+condition.Clause+" "+ch.getPlaceholder(condition.Field))
		values = append(values, condition.Value)
	}
	return strings.Join(queryConditions, conditions.JoinCondition), values
}

func (ch *ClickHouse) insertInTransaction(wrappedTx *Transaction, table *Table, objects []map[string]interface{}) error {
	var headerWithQuotes, headerWithoutQuotes, placeholders []string
	for name := range table.Columns {
		headerWithoutQuotes = append(headerWithoutQuotes, name)
		headerWithQuotes = append(headerWithQuotes, fmt.Sprintf(`"%s"`, name))
		placeholders = append(placeholders, ch.getPlaceholder(name))
	}

	query := fmt.Sprintf(insertCHTemplate, ch.database, table.Name, strings.Join(headerWithQuotes, ", "), strings.Join(placeholders, ", "))
	insertStmt, err := wrappedTx.tx.PrepareContext(ch.ctx, query)
	if err != nil {
		return fmt.Errorf("Error preparing bulk insert statement [%s] table %s statement: %v", query, table.Name, err)
	}

	for _, row := range objects {
		var values []interface{}
		for _, column := range headerWithoutQuotes {
			value, ok := row[column]
			if ok {
				values = append(values, ch.reformatValue(value))
			} else {
				column, _ := table.Columns[column]
				defaultValue, ok := ch.getDefaultValue(column.SQLType)
				if ok {
					values = append(values, defaultValue)
				} else {
					values = append(values, value)
				}

			}
		}

		ch.queryLogger.LogQueryWithValues(query, values)

		_, err = insertStmt.ExecContext(ch.ctx, values...)
		if err != nil {
			return fmt.Errorf("Error bulk inserting in %s table with statement: %s values: %v: %v", table.Name, query, values, err)
		}
	}
	return nil
}

//Close underlying sql.DB
func (ch *ClickHouse) Close() error {
	if err := ch.dataSource.Close(); err != nil {
		return err
	}

	return nil
}

//return ON CLUSTER name clause or "" if config.cluster is empty
func (ch *ClickHouse) getOnClusterClause() string {
	if ch.cluster == "" {
		return ""
	}

	return fmt.Sprintf(onClusterCHClauseTemplate, ch.cluster)
}

//create distributed table, ignore errors
func (ch *ClickHouse) createDistributedTableInTransaction(originTableName string) {
	statement := fmt.Sprintf(createDistributedTableCHTemplate,
		ch.database, originTableName, ch.getOnClusterClause(), ch.database, originTableName, ch.cluster, ch.database, originTableName)
	ch.queryLogger.LogDDL(statement)

	_, err := ch.dataSource.ExecContext(ch.ctx, statement)
	if err != nil {
		logging.Errorf("Error creating distributed table statement with statement [%s] for [%s] : %v", originTableName, statement, err)
		return
	}
}

//drop distributed table, ignore errors
func (ch *ClickHouse) dropDistributedTableInTransaction(wrappedTx *Transaction, originTableName string) {
	query := fmt.Sprintf(dropDistributedTableCHTemplate, ch.database, originTableName, ch.getOnClusterClause())
	ch.queryLogger.LogDDL(query)
	_, err := wrappedTx.tx.ExecContext(ch.ctx, query)
	if err != nil {
		logging.Errorf("Error dropping distributed table for [%s] with statement [%s]: %v", originTableName, query, err)
	}
}

//columnDDL returns column DDL (column name, mapped sql type)
func (ch *ClickHouse) columnDDL(name string, column Column) string {
	//get sql type
	columnSQLType := column.SQLType
	overriddenSQLType, ok := ch.sqlTypes[name]
	if ok {
		columnSQLType = overriddenSQLType.ColumnType
	}

	//get nullable or plain
	var columnTypeDDL string
	if _, ok := ch.nullableFields[name]; ok {
		columnTypeDDL = fmt.Sprintf(columnCHNullableTemplate, columnSQLType)
	} else {
		columnTypeDDL = columnSQLType
	}

	return fmt.Sprintf(`"%s" %s`, name, columnTypeDDL)
}

//getPlaceholder returns "?" placeholder or with typecast
func (ch *ClickHouse) getPlaceholder(columnName string) string {
	castType, ok := ch.sqlTypes[columnName]
	if ok {
		return fmt.Sprintf("cast(?, '%s')", castType.Type)
	}

	return "?"
}

//return nil if column type is nullable or default value for input type
func (ch *ClickHouse) getDefaultValue(sqlType string) (interface{}, bool) {
	if !strings.Contains(strings.ToLower(sqlType), "nullable") {
		//get default value based on type
		dv, ok := defaultValues[strings.ToLower(sqlType)]
		if ok {
			return dv, true
		}

		logging.SystemErrorf("Unknown clickhouse default value for %s", sqlType)
	}

	return nil, false
}

//if value is boolean - reformat it [true = 1; false = 0] ClickHouse supports UInt8 instead of boolean
//otherwise return value as is
func (ch *ClickHouse) reformatValue(v interface{}) interface{} {
	//reformat boolean
	booleanValue, ok := v.(bool)
	if ok {
		if booleanValue {
			return 1
		}

		return 0
	}

	return v
}

func extractStatement(fieldConfigs []FieldConfig) string {
	var parameters []string
	for _, fieldConfig := range fieldConfigs {
		if fieldConfig.Function != "" {
			parameters = append(parameters, fieldConfig.Function+"("+fieldConfig.Field+")")
			continue
		}
		parameters = append(parameters, fieldConfig.Field)
	}
	return strings.Join(parameters, ",")
}
