package adapters

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"database/sql"
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/server/drivers/base"
	"io/ioutil"
	"sort"
	"strings"
	"time"

	"github.com/jitsucom/jitsu/server/errorj"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/typing"
	"github.com/mailru/go-clickhouse"
)

const (
	tableSchemaCHQuery        = `SELECT name, type FROM system.columns WHERE database = ? and table = ?`
	createCHDBTemplate        = `CREATE DATABASE IF NOT EXISTS "%s" %s`
	alterTableCHTemplate      = `ALTER TABLE "%s"."%s" %s %s`
	insertCHTemplate          = `INSERT INTO "%s"."%s" (%s) VALUES %s`
	deleteQueryChTemplate     = `ALTER TABLE %s.%s DELETE WHERE %s`
	dropTableCHTemplate       = `DROP TABLE "%s"."%s" %s`
	onClusterCHClauseTemplate = ` ON CLUSTER "%s" `
	columnCHNullableTemplate  = ` Nullable(%s) `

	createTableCHTemplate              = `CREATE TABLE "%s"."%s" %s (%s) %s %s %s %s`
	createDistributedTableCHTemplate   = `CREATE TABLE "%s"."dist_%s" %s AS "%s"."%s" ENGINE = Distributed(%s,%s,%s,rand())`
	dropDistributedTableCHTemplate     = `DROP TABLE IF EXISTS "%s"."dist_%s" %s`
	alterDistributedTableCHTemplate    = `ALTER TABLE "%s"."dist_%s" %s %s`
	truncateTableCHTemplate            = `TRUNCATE TABLE IF EXISTS "%s"."%s"`
	truncateDistributedTableCHTemplate = `TRUNCATE TABLE IF EXISTS "%s"."dist_%s" %s`

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
		"int16":                    0,
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
		"uint16":                   0,
		"uint32":                   0,
		"uint64":                   0,
		"uint128":                  0,
		"uint256":                  0,
		"string":                   "",
		"lowcardinality(int8)":     0,
		"lowcardinality(int16)":    0,
		"lowcardinality(int32)":    0,
		"lowcardinality(int64)":    0,
		"lowcardinality(int128)":   0,
		"lowcardinality(int256)":   0,
		"lowcardinality(float32)":  0,
		"lowcardinality(float64)":  0,
		"lowcardinality(datetime)": time.Time{},
		"lowcardinality(uint8)":    false,
		"lowcardinality(uint16)":   0,
		"lowcardinality(uint32)":   0,
		"lowcardinality(uint64)":   0,
		"lowcardinality(uint128)":  0,
		"lowcardinality(uint256)":  0,
		"lowcardinality(string)":   "",
		"uuid":                     "00000000-0000-0000-0000-000000000000",
	}
)

//ClickHouseConfig dto for deserialized clickhouse config
type ClickHouseConfig struct {
	Dsns     []string          `mapstructure:"dsns,omitempty" json:"dsns,omitempty" yaml:"dsns,omitempty"`
	Database string            `mapstructure:"db,omitempty" json:"db,omitempty" yaml:"db,omitempty"`
	TLS      map[string]string `mapstructure:"tls,omitempty" json:"tls,omitempty" yaml:"tls,omitempty"`
	Cluster  string            `mapstructure:"cluster,omitempty" json:"cluster,omitempty" yaml:"cluster,omitempty"`
	Engine   *EngineConfig     `mapstructure:"engine,omitempty" json:"engine,omitempty" yaml:"engine,omitempty"`
}

//EngineConfig dto for deserialized clickhouse engine config
type EngineConfig struct {
	RawStatement    string        `mapstructure:"raw_statement,omitempty" json:"raw_statement,omitempty" yaml:"raw_statement,omitempty"`
	NullableFields  []string      `mapstructure:"nullable_fields,omitempty" json:"nullable_fields,omitempty" yaml:"nullable_fields,omitempty"`
	PartitionFields []FieldConfig `mapstructure:"partition_fields,omitempty" json:"partition_fields,omitempty" yaml:"partition_fields,omitempty"`
	OrderFields     []FieldConfig `mapstructure:"order_fields,omitempty" json:"order_fields,omitempty" yaml:"order_fields,omitempty"`
	PrimaryKeys     []string      `mapstructure:"primary_keys,omitempty" json:"primary_keys,omitempty" yaml:"primary_keys,omitempty"`
}

//FieldConfig dto for deserialized clickhouse engine fields
type FieldConfig struct {
	Function string `mapstructure:"function,omitempty" json:"function,omitempty" yaml:"function,omitempty"`
	Field    string `mapstructure:"field,omitempty" json:"field,omitempty" yaml:"field,omitempty"`
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
		if dsn == "" {
			return errors.New("DSNs values can't be empty")
		}

		if !strings.HasPrefix(strings.TrimSpace(dsn), "http") {
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
		engineStatement = `ENGINE = ReplicatedReplacingMergeTree('/clickhouse/tables/{shard}/` + config.Database + `/%s', '{replica}')`
		engineStatementFormat = true
	} else {
		//create table template with ReplacingMergeTree() engine
		engineStatement = `ENGINE = ReplacingMergeTree()`
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

//CreateDB create database instance if doesn't exist
func (ch *ClickHouse) CreateDB(dbName string) error {
	query := fmt.Sprintf(createCHDBTemplate, dbName, ch.getOnClusterClause())
	ch.queryLogger.LogDDL(query)
	if _, err := ch.dataSource.ExecContext(ch.ctx, query); err != nil {
		return errorj.CreateSchemaError.Wrap(err, "failed to create db schema").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Database:  dbName,
				Cluster:   ch.cluster,
				Statement: query,
			})
	}

	return nil
}

//CreateTable create database table with name,columns provided in Table representation
//New tables will have MergeTree() or ReplicatedMergeTree() engine depends on config.cluster empty or not
func (ch *ClickHouse) CreateTable(table *Table) error {
	var columnsDDL []string
	for _, columnName := range table.SortedColumnNames() {
		column := table.Columns[columnName]
		columnTypeDDL := ch.columnDDL(columnName, column)
		columnsDDL = append(columnsDDL, columnTypeDDL)
	}

	//sorting columns asc
	sort.Strings(columnsDDL)
	statementStr := ch.tableStatementFactory.CreateTableStatement(table.Name, strings.Join(columnsDDL, ","))
	ch.queryLogger.LogDDL(statementStr)

	if _, err := ch.dataSource.ExecContext(ch.ctx, statementStr); err != nil {
		return errorj.CreateTableError.Wrap(err, "failed to create table").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Database:    ch.database,
				Cluster:     ch.cluster,
				Table:       table.Name,
				PrimaryKeys: table.GetPKFields(),
				Statement:   statementStr,
			})
	}

	//create distributed table if ReplicatedMergeTree engine
	if ch.cluster != "" {
		ch.createDistributedTableInTransaction(table.Name)
	}

	return nil
}

//GetTableSchema return table (name,columns with name and types) representation wrapped in Table struct
func (ch *ClickHouse) GetTableSchema(tableName string) (*Table, error) {
	table := &Table{Schema: ch.database, Name: tableName, Columns: map[string]typing.SQLColumn{}}
	rows, err := ch.dataSource.QueryContext(ch.ctx, tableSchemaCHQuery, ch.database, tableName)
	if err != nil {
		return nil, errorj.GetTableError.Wrap(err, "failed to get table columns").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Database:    ch.database,
				Cluster:     ch.cluster,
				Table:       tableName,
				PrimaryKeys: table.GetPKFields(),
				Statement:   tableSchemaCHQuery,
				Values:      []interface{}{ch.database, tableName},
			})
	}

	defer rows.Close()
	for rows.Next() {
		var columnName, columnClickhouseType string
		if err := rows.Scan(&columnName, &columnClickhouseType); err != nil {
			return nil, errorj.GetTableError.Wrap(err, "failed to scan result").
				WithProperty(errorj.DBInfo, &ErrorPayload{
					Database:    ch.database,
					Cluster:     ch.cluster,
					Table:       tableName,
					PrimaryKeys: table.GetPKFields(),
					Statement:   tableSchemaCHQuery,
					Values:      []interface{}{ch.database, tableName},
				})
		}

		table.Columns[columnName] = typing.SQLColumn{Type: columnClickhouseType}
	}
	if err := rows.Err(); err != nil {
		return nil, errorj.GetTableError.Wrap(err, "failed read last row").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Database:    ch.database,
				Cluster:     ch.cluster,
				Table:       tableName,
				PrimaryKeys: table.GetPKFields(),
				Statement:   tableSchemaCHQuery,
				Values:      []interface{}{ch.database, tableName},
			})
	}

	return table, nil
}

//PatchTableSchema add new columns(from provided Table) to existing table
//drop and create distributed table
func (ch *ClickHouse) PatchTableSchema(patchSchema *Table) error {
	if len(patchSchema.Columns) == 0 {
		return nil
	}

	addedColumnsDDL := make([]string, 0, len(patchSchema.Columns))
	for _, columnName := range patchSchema.SortedColumnNames() {
		column := patchSchema.Columns[columnName]
		columnDDL := ch.columnDDL(columnName, column)
		addedColumnsDDL = append(addedColumnsDDL, "ADD COLUMN "+columnDDL)
	}

	query := fmt.Sprintf(alterTableCHTemplate, ch.database, patchSchema.Name, ch.getOnClusterClause(), strings.Join(addedColumnsDDL, ", "))
	ch.queryLogger.LogDDL(query)

	if _, err := ch.dataSource.ExecContext(ch.ctx, query); err != nil {
		return errorj.PatchTableError.Wrap(err, "failed to patch table").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Database:    ch.database,
				Cluster:     ch.cluster,
				Table:       patchSchema.Name,
				PrimaryKeys: patchSchema.GetPKFields(),
				Statement:   query,
			})
	}

	//drop and create distributed table if ReplicatedMergeTree engine
	if ch.cluster != "" {
		query := fmt.Sprintf(alterDistributedTableCHTemplate, ch.database, patchSchema.Name, ch.getOnClusterClause(), strings.Join(addedColumnsDDL, ", "))
		ch.queryLogger.LogDDL(query)
		_, err := ch.dataSource.ExecContext(ch.ctx, query)
		switch err := err.(type) {
		case nil:
			return nil
		case *clickhouse.Error:
			if err.Code == 371 {
				// fallback for older clickhouse versions
				ch.dropDistributedTableInTransaction(patchSchema.Name)
				ch.createDistributedTableInTransaction(patchSchema.Name)
				return nil
			}
		}

		logging.Errorf("[%s] Error altering distributed table for [%s] with statement [%s]: %v", ch.destinationId(), patchSchema.Name, query, err)
	}

	return nil
}

//Insert inserts provided object in ClickHouse as a single record or batch
func (ch *ClickHouse) Insert(insertContext *InsertContext) error {
	if !insertContext.deleteConditions.IsEmpty() {
		if err := ch.delete(insertContext.table, insertContext.deleteConditions); err != nil {
			return errorj.Decorate(err, "failed to execute delete in insert")
		}
	}
	return ch.insert(insertContext.table, insertContext.objects...)
}

func (ch *ClickHouse) delete(table *Table, deleteConditions *base.DeleteConditions) error {
	deleteCondition, values := ch.toDeleteQuery(table, deleteConditions)
	deleteQuery := fmt.Sprintf(deleteQueryChTemplate, ch.database, table.Name, deleteCondition)

	ch.queryLogger.LogQueryWithValues(deleteQuery, values)

	if _, err := ch.dataSource.ExecContext(ch.ctx, deleteQuery, values...); err != nil {
		return errorj.DeleteFromTableError.Wrap(err, "failed to delete data").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Database:    ch.database,
				Cluster:     ch.cluster,
				Table:       table.Name,
				PrimaryKeys: table.GetPKFields(),
				Statement:   deleteQuery,
				Values:      values,
			})
	}

	return nil
}

//Truncate deletes all records in tableName table
func (ch *ClickHouse) Truncate(tableName string) error {
	sqlParams := SqlParams{
		dataSource:  ch.dataSource,
		queryLogger: ch.queryLogger,
		ctx:         ch.ctx,
	}

	statement := fmt.Sprintf(truncateTableCHTemplate, ch.database, tableName)
	if err := sqlParams.commonTruncate(statement); err != nil {
		return errorj.TruncateError.Wrap(err, "failed to truncate table").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Database:  ch.database,
				Cluster:   ch.cluster,
				Table:     tableName,
				Statement: statement,
			})
	}
	if ch.cluster != "" {
		statement = fmt.Sprintf(truncateDistributedTableCHTemplate, ch.database, tableName, ch.getOnClusterClause())
		if err := sqlParams.commonTruncate(statement); err != nil {
			logging.Errorf("[%s] error truncating distributed table with statement [%s]", ch.destinationId(), statement)
		}
	}

	return nil
}

//DropTable drops table in transaction
func (ch *ClickHouse) DropTable(table *Table) error {
	query := fmt.Sprintf(dropTableCHTemplate, ch.database, table.Name, ch.getOnClusterClause())
	ch.queryLogger.LogDDL(query)

	if _, err := ch.dataSource.ExecContext(ch.ctx, query); err != nil {
		return fmt.Errorf("Error dropping [%s] table: %v", table.Name, err)
	}

	if ch.cluster != "" {
		ch.dropDistributedTableInTransaction(table.Name)
	}

	return nil
}

func (ch *ClickHouse) toDeleteQuery(table *Table, conditions *base.DeleteConditions) (string, []interface{}) {
	var queryConditions []string
	var values []interface{}
	for _, condition := range conditions.Conditions {
		queryConditions = append(queryConditions, condition.Field+" "+condition.Clause+" "+ch.getPlaceholder(condition.Field, table.Columns[condition.Field]))
		values = append(values, typing.ReformatValue(condition.Value))
	}
	return strings.Join(queryConditions, " "+conditions.JoinCondition+" "), values
}

//insert creates statement like insert ... values (), (), ()
//runs executeInsert func
func (ch *ClickHouse) insert(table *Table, objects ...map[string]interface{}) error {
	var placeholdersBuilder strings.Builder
	var headerWithoutQuotes, headerWithQuotes []string
	for _, name := range table.SortedColumnNames() {
		headerWithoutQuotes = append(headerWithoutQuotes, name)
		headerWithQuotes = append(headerWithQuotes, fmt.Sprintf(`"%s"`, name))
	}
	maxValues := len(objects) * len(table.Columns)
	valueArgs := make([]interface{}, 0, maxValues)
	for _, row := range objects {
		_, _ = placeholdersBuilder.WriteString("(")

		for i, column := range headerWithoutQuotes {
			//append value
			value, ok := row[column]
			if ok {
				valueArgs = append(valueArgs, ch.reformatValue(value))
			} else {
				column, _ := table.Columns[column]
				defaultValue, ok := ch.getDefaultValue(column.Type)
				if ok {
					valueArgs = append(valueArgs, defaultValue)
				} else {
					valueArgs = append(valueArgs, value)
				}

			}
			//placeholder
			placeholder := ch.getPlaceholder(column, table.Columns[column])

			_, _ = placeholdersBuilder.WriteString(placeholder)

			if i < len(headerWithoutQuotes)-1 {
				_, _ = placeholdersBuilder.WriteString(",")
			}
		}
		_, _ = placeholdersBuilder.WriteString("),")
	}

	if err := ch.executeInsert(table, headerWithQuotes, removeLastComma(placeholdersBuilder.String()), valueArgs, len(objects)); err != nil {
		return err
	}

	return nil
}

//executeInsert execute insert with insertTemplate
func (ch *ClickHouse) executeInsert(table *Table, headerWithQuotes []string, placeholders string, valueArgs []interface{}, objectsCount int) error {
	statement := fmt.Sprintf(insertCHTemplate, ch.database, table.Name, strings.Join(headerWithQuotes, ", "), placeholders)

	ch.queryLogger.LogQueryWithValues(statement, valueArgs)

	if _, err := ch.dataSource.Exec(statement, valueArgs...); err != nil {
		return errorj.ExecuteInsertInBatchError.Wrap(err, "failed to execute insert").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Database:        ch.database,
				Cluster:         ch.cluster,
				Table:           table.Name,
				PrimaryKeys:     table.GetPKFields(),
				Statement:       statement,
				ValuesMapString: ObjectValuesToString(headerWithQuotes, valueArgs),
				TotalObjects:    objectsCount,
			})
	}

	return nil
}

//Close underlying sql.DB
func (ch *ClickHouse) Close() error {
	return ch.dataSource.Close()
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

	if _, err := ch.dataSource.ExecContext(ch.ctx, statement); err != nil {
		logging.Errorf("[%s] Error creating distributed table statement with statement [%s] for [%s] : %v", ch.destinationId(), statement, originTableName, err)
	}
}

//drop distributed table, ignore errors
func (ch *ClickHouse) dropDistributedTableInTransaction(originTableName string) {
	query := fmt.Sprintf(dropDistributedTableCHTemplate, ch.database, originTableName, ch.getOnClusterClause())
	ch.queryLogger.LogDDL(query)
	if _, err := ch.dataSource.ExecContext(ch.ctx, query); err != nil {
		logging.Errorf("[%s] Error dropping distributed table for [%s] with statement [%s]: %v", ch.destinationId(), originTableName, query, err)
	}
}

//columnDDL returns column DDL (column name, mapped sql type)
func (ch *ClickHouse) columnDDL(name string, column typing.SQLColumn) string {
	//get sql type
	columnSQLType := column.DDLType()
	overriddenSQLType, ok := ch.sqlTypes[name]
	if ok {
		columnSQLType = overriddenSQLType.DDLType()
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
func (ch *ClickHouse) getPlaceholder(columnName string, column typing.SQLColumn) string {
	castType, ok := ch.sqlTypes[columnName]
	if !ok && column.Override {
		castType = column
		ok = true
	}
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

func (ch *ClickHouse) destinationId() interface{} {
	return ch.ctx.Value(CtxDestinationId)
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

func (ch *ClickHouse) Update(table *Table, object map[string]interface{}, whereKey string, whereValue interface{}) error {
	//TODO Add Sign property for CollapcingMergeTree
	return ch.insert(table, object)
}
