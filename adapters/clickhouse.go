package adapters

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"database/sql"
	"errors"
	"fmt"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/schema"
	"github.com/jitsucom/eventnative/typing"
	"github.com/mailru/go-clickhouse"
	"io/ioutil"
	"sort"
	"strings"
)

const (
	tableSchemaCHQuery        = `SELECT name, type FROM system.columns WHERE database = ? and table = ?`
	createCHDBTemplate        = `CREATE DATABASE IF NOT EXISTS "%s" %s`
	addColumnCHTemplate       = `ALTER TABLE "%s"."%s" %s ADD COLUMN %s %s`
	insertCHTemplate          = `INSERT INTO "%s"."%s" (%s) VALUES (%s)`
	onClusterCHClauseTemplate = ` ON CLUSTER "%s" `
	columnCHNullableTemplate  = ` Nullable(%s) `

	createTableCHTemplate            = `CREATE TABLE "%s"."%s" %s (%s) %s %s %s %s`
	createDistributedTableCHTemplate = `CREATE TABLE "%s"."dist_%s" %s AS "%s"."%s" ENGINE = Distributed(%s,%s,%s,rand())`
	dropDistributedTableCHTemplate   = `DROP TABLE "%s"."dist_%s" %s`

	defaultPartition  = `PARTITION BY (toYYYYMM(_timestamp))`
	defaultOrderBy    = `ORDER BY (eventn_ctx_event_id)`
	defaultPrimaryKey = ``
)

var (
	schemaToClickhouse = map[typing.DataType]string{
		typing.STRING:    "String",
		typing.INT64:     "Int64",
		typing.FLOAT64:   "Float64",
		typing.TIMESTAMP: "DateTime",
	}

	clickhouseToSchema = map[string]typing.DataType{
		"String":             typing.STRING,
		"Nullable(String)":   typing.STRING,
		"Int64":              typing.INT64,
		"Nullable(Int64)":    typing.INT64,
		"Float64":            typing.FLOAT64,
		"Nullable(Float64)":  typing.FLOAT64,
		"DateTime":           typing.TIMESTAMP,
		"Nullable(DateTime)": typing.TIMESTAMP,
	}
)

//ClickHouseConfig dto for deserialized clickhouse config
type ClickHouseConfig struct {
	Dsns     []string          `mapstructure:"dsns" json:"dsns,omitempty" yaml:"dsns,omitempty"`
	Database string            `mapstructure:"db" json:"db,omitempty" yaml:"db,omitempty"`
	Tls      map[string]string `mapstructure:"tls" json:"tls,omitempty" yaml:"tls,omitempty"`
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
	destinationId         string
}

//NewClickHouse return configured ClickHouse adapter instance
func NewClickHouse(ctx context.Context, connectionString, database, cluster string, tlsConfig map[string]string,
	tableStatementFactory *TableStatementFactory, nullableFields map[string]bool,
	queryLogger *logging.QueryLogger, destinationId string) (*ClickHouse, error) {
	if destinationId == "" {
		return nil, fmt.Errorf("destinationId must be not empty")
	}
	if queryLogger == nil {
		queryLogger = &logging.QueryLogger{}
	}

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
	//connect
	dataSource, err := sql.Open("clickhouse", connectionString)
	if err != nil {
		return nil, err
	}
	if err := dataSource.Ping(); err != nil {
		return nil, err
	}

	return &ClickHouse{
		ctx:                   ctx,
		database:              database,
		cluster:               cluster,
		dataSource:            dataSource,
		tableStatementFactory: tableStatementFactory,
		nullableFields:        nullableFields,
		destinationId:         destinationId,
		queryLogger:           queryLogger,
	}, nil
}

func (ClickHouse) Name() string {
	return "ClickHouse"
}

//OpenTx open underline sql transaction and return wrapped instance
func (ch *ClickHouse) OpenTx() (*Transaction, error) {
	tx, err := ch.dataSource.BeginTx(ch.ctx, nil)
	if err != nil {
		return nil, err
	}

	return &Transaction{tx: tx, dbType: ch.Name()}, nil
}

//CreateDB create database instance if doesn't exist
func (ch *ClickHouse) CreateDB(dbName string) error {
	wrappedTx, err := ch.OpenTx()
	if err != nil {
		return err
	}

	query := fmt.Sprintf(createCHDBTemplate, dbName, ch.getOnClusterClause())
	ch.queryLogger.Log(ch.destinationId, query)
	createStmt, err := wrappedTx.tx.PrepareContext(ch.ctx, query)
	if err != nil {
		wrappedTx.Rollback()
		return fmt.Errorf("Error preparing create db %s statement: %v", dbName, err)
	}

	_, err = createStmt.ExecContext(ch.ctx)

	if err != nil {
		wrappedTx.Rollback()
		return fmt.Errorf("Error creating [%s] db: %v", dbName, err)
	}
	return wrappedTx.tx.Commit()
}

//CreateTable create database table with name,columns provided in schema.Table representation
//New tables will have MergeTree() or ReplicatedMergeTree() engine depends on config.cluster empty or not
func (ch *ClickHouse) CreateTable(tableSchema *schema.Table) error {
	wrappedTx, err := ch.OpenTx()
	if err != nil {
		return err
	}

	var columnsDDL []string
	for columnName, column := range tableSchema.Columns {
		mappedType, ok := schemaToClickhouse[column.GetType()]
		if !ok {
			logging.Error("Unknown clickhouse schema type:", column.GetType())
			mappedType = schemaToClickhouse[typing.STRING]
		}
		var addColumnDDL string
		if _, ok := ch.nullableFields[columnName]; ok {
			addColumnDDL = columnName + fmt.Sprintf(columnCHNullableTemplate, mappedType)
		} else {
			addColumnDDL = columnName + " " + mappedType
		}
		columnsDDL = append(columnsDDL, addColumnDDL)
	}

	//sorting columns asc
	sort.Strings(columnsDDL)
	statementStr := ch.tableStatementFactory.CreateTableStatement(tableSchema.Name, strings.Join(columnsDDL, ","))
	ch.queryLogger.Log(ch.destinationId, statementStr)
	createStmt, err := wrappedTx.tx.PrepareContext(ch.ctx, statementStr)
	if err != nil {
		return fmt.Errorf("Error preparing create table [%s] statement [%s]: %v", tableSchema.Name, statementStr, err)
	}

	if _, err = createStmt.ExecContext(ch.ctx); err != nil {
		return fmt.Errorf("Error creating [%s] table with statement [%s]: %v", tableSchema.Name, statementStr, err)
	}

	//create distributed table if ReplicatedMergeTree engine
	if ch.cluster != "" {
		ch.createDistributedTableInTransaction(wrappedTx, tableSchema.Name)
	}

	return wrappedTx.tx.Commit()
}

//GetTableSchema return table (name,columns with name and types) representation wrapped in schema.Table struct
func (ch *ClickHouse) GetTableSchema(tableName string) (*schema.Table, error) {
	table := &schema.Table{Name: tableName, Columns: schema.Columns{}}
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

		mappedType, ok := clickhouseToSchema[columnClickhouseType]
		if !ok {
			logging.Error("Unknown clickhouse column type:", columnClickhouseType)
			mappedType = typing.STRING
		}
		table.Columns[columnName] = schema.NewColumn(mappedType)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("Last rows.Err: %v", err)
	}

	return table, nil
}

//PatchTableSchema add new columns(from provided schema.Table) to existing table
//drop and create distributed table
func (ch *ClickHouse) PatchTableSchema(patchSchema *schema.Table) error {
	wrappedTx, err := ch.OpenTx()
	if err != nil {
		return err
	}

	for columnName, column := range patchSchema.Columns {
		mappedType, ok := schemaToClickhouse[column.GetType()]
		if !ok {
			logging.Error("Unknown clickhouse schema type:", column.GetType().String())
			mappedType = schemaToClickhouse[typing.STRING]
		}
		var columnTypeDDL string
		if _, ok := ch.nullableFields[columnName]; ok {
			columnTypeDDL = fmt.Sprintf(columnCHNullableTemplate, mappedType)
		} else {
			columnTypeDDL = mappedType
		}
		query := fmt.Sprintf(addColumnCHTemplate, ch.database, patchSchema.Name, ch.getOnClusterClause(), columnName, columnTypeDDL)
		ch.queryLogger.Log(ch.destinationId, query)
		alterStmt, err := wrappedTx.tx.PrepareContext(ch.ctx, query)
		if err != nil {
			wrappedTx.Rollback()
			return fmt.Errorf("Error preparing patching table %s schema statement: %v", patchSchema.Name, err)
		}

		_, err = alterStmt.ExecContext(ch.ctx)
		if err != nil {
			wrappedTx.Rollback()
			return fmt.Errorf("Error patching %s table with '%s' - %s column schema: %v", patchSchema.Name, columnName, columnTypeDDL, err)
		}
	}

	//drop and create distributed table if ReplicatedMergeTree engine
	if ch.cluster != "" {
		ch.dropDistributedTableInTransaction(wrappedTx, patchSchema.Name)
		ch.createDistributedTableInTransaction(wrappedTx, patchSchema.Name)
	}

	return wrappedTx.tx.Commit()
}

//Insert provided object in ClickHouse in stream mode
func (ch *ClickHouse) Insert(schema *schema.Table, valuesMap map[string]interface{}) error {
	wrappedTx, err := ch.OpenTx()
	if err != nil {
		return err
	}

	if err := ch.InsertInTransaction(wrappedTx, schema, valuesMap); err != nil {
		wrappedTx.Rollback()
		return err
	}

	return wrappedTx.DirectCommit()
}

//Insert provided object in ClickHouse in transaction
func (ch *ClickHouse) InsertInTransaction(wrappedTx *Transaction, schema *schema.Table, valuesMap map[string]interface{}) error {
	var header, placeholders string
	var values []interface{}
	for name, value := range valuesMap {
		header += name + ","
		//?, ?, ?, etc
		placeholders += "?,"
		values = append(values, value)
	}

	header = removeLastComma(header)
	placeholders = removeLastComma(placeholders)

	query := fmt.Sprintf(insertCHTemplate, ch.database, schema.Name, header, placeholders)
	ch.queryLogger.LogWithValues(ch.destinationId, query, values)
	insertStmt, err := wrappedTx.tx.PrepareContext(ch.ctx, query)
	if err != nil {
		return fmt.Errorf("Error preparing insert table %s statement: %v", schema.Name, err)
	}

	_, err = insertStmt.ExecContext(ch.ctx, values...)
	if err != nil {
		return fmt.Errorf("Error inserting in %s table with statement: %s values: %v: %v", schema.Name, header, values, err)
	}

	return nil
}

func (ch *ClickHouse) UpdatePrimaryKey(patchTableSchema *schema.Table, patchConstraint *schema.PKFieldsPatch) error {
	logging.Warn("Constraints update is not supported for Snowflake yet")
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
func (ch *ClickHouse) createDistributedTableInTransaction(wrappedTx *Transaction, originTableName string) {
	query := fmt.Sprintf(createDistributedTableCHTemplate,
		ch.database, originTableName, ch.getOnClusterClause(), ch.database, originTableName, ch.cluster, ch.database, originTableName)
	ch.queryLogger.Log(ch.destinationId, query)
	createStmt, err := wrappedTx.tx.PrepareContext(ch.ctx, query)
	if err != nil {
		logging.Errorf("Error preparing create distributed table statement for [%s] : %v", originTableName, err)
		return
	}

	if _, err = createStmt.ExecContext(ch.ctx); err != nil {
		logging.Errorf("Error creating distributed table for [%s] : %v", originTableName, err)
	}
}

//drop distributed table, ignore errors
func (ch *ClickHouse) dropDistributedTableInTransaction(wrappedTx *Transaction, originTableName string) {
	query := fmt.Sprintf(dropDistributedTableCHTemplate, ch.database, originTableName, ch.getOnClusterClause())
	ch.queryLogger.Log(ch.destinationId, query)
	createStmt, err := wrappedTx.tx.PrepareContext(ch.ctx, query)
	if err != nil {
		logging.Errorf("Error preparing drop distributed table statement for [%s] : %v", originTableName, err)
		return
	}

	if _, err = createStmt.ExecContext(ch.ctx); err != nil {
		logging.Errorf("Error dropping distributed table for [%s] : %v", originTableName, err)
	}
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
