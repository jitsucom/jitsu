package adapters

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"database/sql"
	"errors"
	"fmt"
	"github.com/ksensehq/eventnative/schema"
	"github.com/ksensehq/eventnative/timestamp"
	"github.com/mailru/go-clickhouse"
	"io/ioutil"
	"log"
	"strings"
)

const (
	tableSchemaCHQuery               = `SELECT name, type FROM system.columns WHERE database = ? and table = ?`
	addColumnCHTemplate              = `ALTER TABLE "%s"."%s" %s ADD COLUMN %s Nullable(%s)`
	createTableCHTemplate            = `CREATE TABLE "%s"."%s" (%s) ENGINE = MergeTree() ORDER BY (_timestamp)`
	createReplicatedTableCHTemplate  = `CREATE TABLE "%s"."%s" %s (%s) ENGINE = ReplicatedMergeTree('/clickhouse/tables/{shard}/%s/%s', '{replica}') ORDER BY (_timestamp)`
	createDistributedTableCHTemplate = `CREATE TABLE "%s"."%s" %s AS "%s"."%s" ENGINE = Distributed(%s,%s,%s,rand())`
	columnCHNullableTemplate         = ` Nullable(%s) `
	insertCHTemplate                 = `INSERT INTO "%s"."%s" (%s) VALUES (%s)`
	onClusterCHClauseTemplate        = ` ON CLUSTER %s `
)

var (
	schemaToClickhouse = map[schema.DataType]string{
		schema.STRING: "String",
	}

	clickhouseToSchema = map[string]schema.DataType{
		"String":           schema.STRING,
		"Nullable(String)": schema.STRING,
	}
)

//ClickHouseConfig dto for deserialized clickhouse config
type ClickHouseConfig struct {
	Dsns     []string          `mapstructure:"dsns"`
	Database string            `mapstructure:"db"`
	Tls      map[string]string `mapstructure:"tls"`
	Cluster  string            `mapstructure:"cluster"`
}

//Validate required fields in ClickHouseConfig
func (chc *ClickHouseConfig) Validate() error {
	if chc == nil {
		return errors.New("ClickHouse config is required")
	}

	if len(chc.Dsns) == 0 {
		return errors.New("dsn is required parameter")
	}

	if chc.Cluster == "" && len(chc.Dsns) > 1 {
		return errors.New("cluster is required parameter when dsns count > 1")
	}

	if chc.Database == "" {
		return errors.New("db is required parameter")
	}

	return nil
}

//ClickHouse is adapter for creating,patching (schema or table), inserting data to clickhouse
type ClickHouse struct {
	ctx        context.Context
	database   string
	cluster    string
	dataSource *sql.DB
}

//NewClickHouse return configured ClickHouse adapter instance
func NewClickHouse(ctx context.Context, connectionString, database, cluster string, tlsConfig map[string]string) (*ClickHouse, error) {
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

	dataSource, err := sql.Open("clickhouse", connectionString)
	if err != nil {
		return nil, err
	}

	if err := dataSource.Ping(); err != nil {
		return nil, err
	}

	return &ClickHouse{ctx: ctx, database: database, cluster: cluster, dataSource: dataSource}, nil
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

//CreateTable create database table with name,columns provided in schema.Table representation
//New tables will have MergeTree() or ReplicatedMergeTree() engine depends on config.cluster empty or not
func (ch *ClickHouse) CreateTable(tableSchema *schema.Table) error {
	wrappedTx, err := ch.OpenTx()
	if err != nil {
		return err
	}

	var columnsDDL []string
	for columnName, column := range tableSchema.Columns {
		mappedType, ok := schemaToClickhouse[column.Type]
		if !ok {
			log.Println("Unknown clickhouse schema type:", column.Type)
			mappedType = schemaToClickhouse[schema.STRING]
		}
		var addColumnDDL string
		//clickhouse table must have one order field. It will be _timestamp as default
		if columnName == timestamp.Key {
			addColumnDDL = columnName + " " + mappedType
		} else {
			addColumnDDL = columnName + fmt.Sprintf(columnCHNullableTemplate, mappedType)
		}
		columnsDDL = append(columnsDDL, addColumnDDL)
	}

	var createTableStatement string
	if ch.cluster == "" {
		//create table with MergeTree() engine
		createTableStatement = fmt.Sprintf(createTableCHTemplate, ch.database, tableSchema.Name, strings.Join(columnsDDL, ","))
	} else {
		//create table with ReplicatedMergeTree() engine
		createTableStatement = fmt.Sprintf(createReplicatedTableCHTemplate, ch.database, tableSchema.Name,
			ch.getOnClusterClause(), strings.Join(columnsDDL, ","), ch.database, tableSchema.Name)
	}

	createStmt, err := wrappedTx.tx.PrepareContext(ch.ctx, createTableStatement)
	if err != nil {
		wrappedTx.Rollback()
		return fmt.Errorf("Error preparing create table %s statement: %v", tableSchema.Name, err)
	}

	if _, err = createStmt.ExecContext(ch.ctx); err != nil {
		wrappedTx.Rollback()
		return fmt.Errorf("Error creating [%s] table: %v", tableSchema.Name, err)
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
			log.Println("Unknown clickhouse column type:", columnClickhouseType)
			mappedType = schema.STRING
		}
		table.Columns[columnName] = schema.Column{Type: mappedType}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("Last rows.Err: %v", err)
	}

	return table, nil
}

//PatchTableSchema add new columns(from provided schema.Table) to existing table
func (ch *ClickHouse) PatchTableSchema(patchSchema *schema.Table) error {
	wrappedTx, err := ch.OpenTx()
	if err != nil {
		return err
	}

	for columnName, column := range patchSchema.Columns {
		mappedColumnType, ok := schemaToClickhouse[column.Type]
		if !ok {
			log.Println("Unknown clickhouse schema type:", column.Type.String())
			mappedColumnType = schemaToClickhouse[schema.STRING]
		}
		alterStmt, err := wrappedTx.tx.PrepareContext(ch.ctx, fmt.Sprintf(addColumnCHTemplate, ch.database, patchSchema.Name, columnName, mappedColumnType))
		if err != nil {
			wrappedTx.Rollback()
			return fmt.Errorf("Error preparing patching table %s schema statement: %v", patchSchema.Name, err)
		}

		_, err = alterStmt.ExecContext(ch.ctx)
		if err != nil {
			wrappedTx.Rollback()
			return fmt.Errorf("Error patching %s table with '%s' - %s column schema: %v", patchSchema.Name, columnName, mappedColumnType, err)
		}
	}

	return wrappedTx.tx.Commit()
}

//Insert provided object in ClickHouse
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

	insertStmt, err := wrappedTx.tx.PrepareContext(ch.ctx, fmt.Sprintf(insertCHTemplate, ch.database, schema.Name, header, placeholders))
	if err != nil {
		return fmt.Errorf("Error preparing insert table %s statement: %v", schema.Name, err)
	}

	_, err = insertStmt.ExecContext(ch.ctx, values...)
	if err != nil {
		return fmt.Errorf("Error inserting in %s table with statement: %s values: %v: %v", schema.Name, header, values, err)
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
func (ch *ClickHouse) createDistributedTableInTransaction(wrappedTx *Transaction, originTableName string) {
	createStmt, err := wrappedTx.tx.PrepareContext(ch.ctx, fmt.Sprintf(createDistributedTableCHTemplate,
		ch.database, "dist_"+originTableName, ch.getOnClusterClause(), ch.database, originTableName, ch.cluster, ch.database, originTableName))
	if err != nil {
		log.Println("Error preparing create distributed table statement for [%s] : %v", originTableName, err)
		return
	}

	if _, err = createStmt.ExecContext(ch.ctx); err != nil {
		wrappedTx.Rollback()
		log.Println("Error creating distributed table for [%s] : %v", originTableName, err)
	}
}
