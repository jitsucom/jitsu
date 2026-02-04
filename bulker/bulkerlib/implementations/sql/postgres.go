package sql

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"net"
	"os"
	"path"
	"strings"
	"text/template"
	"time"

	"cloud.google.com/go/cloudsqlconn"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	_ "github.com/jackc/pgx/v5/stdlib"
	bulker "github.com/jitsucom/bulker/bulkerlib"
	types2 "github.com/jitsucom/bulker/bulkerlib/types"
	"github.com/jitsucom/bulker/jitsubase/errorj"
	"github.com/jitsucom/bulker/jitsubase/jsoniter"
	"github.com/jitsucom/bulker/jitsubase/jsonorder"
	"github.com/jitsucom/bulker/jitsubase/logging"
	"github.com/jitsucom/bulker/jitsubase/utils"
)

func init() {
	bulker.RegisterBulker(PostgresBulkerTypeId, NewPostgres)
}

const (
	PostgresBulkerTypeId = "postgres"

	pgTableSchemaQuery = `SELECT 
 							pg_attribute.attname AS name,
    						pg_catalog.format_type(pg_attribute.atttypid,pg_attribute.atttypmod) AS column_type
						FROM pg_attribute
         					JOIN pg_class ON pg_class.oid = pg_attribute.attrelid
         					LEFT JOIN pg_attrdef pg_attrdef ON pg_attrdef.adrelid = pg_class.oid AND pg_attrdef.adnum = pg_attribute.attnum
         					LEFT JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
         					LEFT JOIN pg_constraint ON pg_constraint.conrelid = pg_class.oid AND pg_attribute.attnum = ANY (pg_constraint.conkey)
						WHERE pg_class.relkind = 'r'::char
  							AND  pg_namespace.nspname ilike $1
  							AND pg_class.relname = $2
  							AND pg_attribute.attnum > 0 order by pg_attribute.attnum`
	pgPrimaryKeyFieldsQuery = `SELECT tco.constraint_name as constraint_name,
       kcu.column_name as key_column
FROM information_schema.table_constraints tco
         JOIN information_schema.key_column_usage kcu
              ON kcu.constraint_name = tco.constraint_name
                  AND kcu.constraint_schema = tco.constraint_schema
                  AND kcu.constraint_name = tco.constraint_name
WHERE tco.constraint_type = 'PRIMARY KEY' AND 
      kcu.table_schema ilike $1 AND
      kcu.table_name = $2 order by kcu.ordinal_position`
	pgCreateDbSchemaIfNotExistsTemplate = `CREATE SCHEMA IF NOT EXISTS "%s"`
	pgCreateIndexTemplate               = `CREATE INDEX ON %s%s (%s);`

	pgMergeQuery = `INSERT INTO {{.Namespace}}{{.TableName}}({{.Columns}}) VALUES ({{.Placeholders}}) ON CONFLICT ON CONSTRAINT {{.PrimaryKeyName}} DO UPDATE set {{.UpdateSet}}`

	pgLoadStatement = `INSERT INTO %s%s (%s) VALUES %s`

	pgBulkMergeQuery       = `INSERT INTO {{.Namespace}}{{.TableTo}}({{.Columns}}) SELECT {{.Columns}} FROM {{.NamespaceFrom}}{{.TableFrom}} ON CONFLICT ON CONSTRAINT {{.PrimaryKeyName}} DO UPDATE SET {{.UpdateSet}}`
	pgBulkMergeSourceAlias = `excluded`
)

var (
	pgMergeQueryTemplate, _     = template.New("postgresMergeQuery").Parse(pgMergeQuery)
	pgBulkMergeQueryTemplate, _ = template.New("postgresBulkMergeQuery").Parse(pgBulkMergeQuery)

	postgresDataTypes = map[types2.DataType][]string{
		types2.STRING:    {"text", "varchar", "uuid"},
		types2.INT64:     {"bigint"},
		types2.FLOAT64:   {"double precision"},
		types2.TIMESTAMP: {"timestamp with time zone", "timestamp", "timestamp without time zone", "date"},
		types2.BOOL:      {"boolean"},
		types2.JSON:      {"jsonb", "json"},
		types2.UNKNOWN:   {"text"},
	}
)

type PostgresConfig struct {
	DataSourceConfig       `mapstructure:",squash"`
	SSLConfig              `mapstructure:",squash"`
	AuthenticationMethod   string `mapstructure:"authenticationMethod,omitempty" json:"authenticationMethod,omitempty" yaml:"authenticationMethod,omitempty"`
	InstanceConnectionName string `mapstructure:"instanceConnectionName,omitempty" json:"instanceConnectionName,omitempty" yaml:"instanceConnectionName,omitempty"`
}

// Postgres is adapter for creating,patching (schema or table), inserting data to postgres
type Postgres struct {
	*SQLAdapterBase[PostgresConfig]
	tmpDir string
}

func (p *Postgres) Type() string {
	return PostgresBulkerTypeId
}

// NewPostgres return configured Postgres bulker.Bulker instance
func NewPostgres(bulkerConfig bulker.Config) (bulker.Bulker, error) {
	config := &PostgresConfig{}
	if err := utils.ParseObject(bulkerConfig.DestinationConfig, config); err != nil {
		return nil, fmt.Errorf("failed to parse destination config: %v", err)
	}
	if err := config.Validate(); err != nil {
		return nil, err
	}
	//create tmp dir for ssl certs if any
	tmpDir, err := os.MkdirTemp("", "postgres_"+bulkerConfig.Id)
	if err != nil && (config.SSLMode == "verify-ca" || config.SSLMode == "verify-full") {
		return nil, fmt.Errorf("failed to create tmp dir for postgres ssl certs: %v", err)
	}
	if err = ProcessSSL(tmpDir, config); err != nil {
		return nil, err
	}
	if config.Parameters == nil {
		config.Parameters = map[string]string{}
	}
	utils.MapPutIfAbsent(config.Parameters, "connect_timeout", "90")

	typecastFunc := func(placeholder string, column types2.SQLColumn) string {
		if column.Override {
			return placeholder + "::" + column.Type
		}
		return placeholder
	}
	valueMappingFunc := func(value any, valuePresent bool, sqlColumn types2.SQLColumn) any {
		//replace zero byte character for text fields
		if valuePresent {
			if sqlColumn.DataType == types2.STRING {
				switch v := value.(type) {
				case string:
					value = strings.ReplaceAll(v, "\u0000", "")
				case time.Time:
					value = v.UTC().Format(time.RFC3339Nano)
				case nil:
					value = v
				default:
					value = fmt.Sprint(v)
				}
			} else if sqlColumn.DataType == types2.JSON {
				if v, ok := value.(string); ok {
					value = strings.ReplaceAll(v, "\\u0000", "")
				}
			}
		}
		return value
	}
	var queryLogger *logging.QueryLogger
	if bulkerConfig.LogLevel == bulker.Verbose {
		queryLogger = logging.NewQueryLogger(bulkerConfig.Id, os.Stderr, os.Stderr)
	}

	dbConnectFunction := func(ctx context.Context, cfg *PostgresConfig) (*sql.DB, error) {
		if cfg.AuthenticationMethod == "google-psc" {
			dialer, err := cloudsqlconn.NewDialer(
				ctx,
				cloudsqlconn.WithIAMAuthN(),
				cloudsqlconn.WithLazyRefresh(),
				cloudsqlconn.WithDNSResolver(),
			)
			if err != nil {
				return nil, fmt.Errorf("failed to create cloudsql dialer: %v", err)
			}
			username := cfg.Username
			if username == "" {
				username = utils.DefaultString(os.Getenv("GOOGLE_PSC_SQL_USERNAME"), os.Getenv("BULKER_GOOGLE_PSC_SQL_USERNAME"))
			}
			connectionString := fmt.Sprintf("user=%s database=%s search_path=%s", username, cfg.Db, config.Schema)
			for k, v := range config.Parameters {
				connectionString += " " + k + "=" + v + " "
			}
			pgxConfig, err := pgx.ParseConfig(connectionString)
			if err != nil {
				return nil, fmt.Errorf("failed to parse dsn: %v", err)
			}
			pgxConfig.DialFunc = func(ctx context.Context, network, instance string) (net.Conn, error) {
				return dialer.Dial(ctx, cfg.InstanceConnectionName, cloudsqlconn.WithPSC())
			}
			dbURI := stdlib.RegisterConnConfig(pgxConfig)
			dataSource, err := sql.Open("pgx", dbURI)
			if err != nil {
				return nil, err
			}
			if err := dataSource.PingContext(ctx); err != nil {
				_ = dataSource.Close()
				return nil, err
			}
			dataSource.SetConnMaxIdleTime(3 * time.Minute)
			dataSource.SetMaxIdleConns(10)
			return dataSource, nil
		} else {
			connectionString := fmt.Sprintf("host=%s port=%d dbname=%s user=%s password=%s search_path=%s",
				config.Host, config.Port, config.Db, config.Username, config.Password, config.Schema)
			//concat provided connection parameters
			for k, v := range config.Parameters {
				connectionString += " " + k + "=" + v + " "
			}
			logging.Infof("[%s] connecting: %s", bulkerConfig.Id, connectionString)
			dataSource, err := sql.Open("pgx", connectionString)
			if err != nil {
				return nil, err
			}
			if err := dataSource.PingContext(ctx); err != nil {
				_ = dataSource.Close()
				return nil, err
			}
			dataSource.SetConnMaxIdleTime(3 * time.Minute)
			dataSource.SetMaxIdleConns(10)
			return dataSource, nil
		}
	}
	sqlAdapterBase, err := newSQLAdapterBase(bulkerConfig.Id, PostgresBulkerTypeId, config, config.Schema, dbConnectFunction, postgresDataTypes, queryLogger, typecastFunc, IndexParameterPlaceholder, pgColumnDDL, valueMappingFunc, checkErr, true)
	p := &Postgres{sqlAdapterBase, tmpDir}
	// some clients have no permission to create tmp tables
	p.temporaryTables = false
	p.tableHelper = NewTableHelper(PostgresBulkerTypeId, 63, '"')
	return p, err
}

func (p *Postgres) CreateStream(id, tableName string, mode bulker.BulkMode, streamOptions ...bulker.StreamOption) (bulker.BulkerStream, error) {
	streamOptions = append(streamOptions, withLocalBatchFile(fmt.Sprintf("bulker_%s", utils.SanitizeString(id))))

	if err := p.validateOptions(streamOptions); err != nil {
		return nil, err
	}
	switch mode {
	case bulker.Stream:
		return newAutoCommitStream(id, p, tableName, streamOptions...)
	case bulker.Batch:
		return newTransactionalStream(id, p, tableName, streamOptions...)
	case bulker.ReplaceTable:
		return newReplaceTableStream(id, p, tableName, streamOptions...)
	case bulker.ReplacePartition:
		return newReplacePartitionStream(id, p, tableName, streamOptions...)
	}
	return nil, fmt.Errorf("unsupported bulk mode: %s", mode)
}

func (p *Postgres) validateOptions(streamOptions []bulker.StreamOption) error {
	options := &bulker.StreamOptions{}
	for _, option := range streamOptions {
		options.Add(option)
	}
	return nil
}

// OpenTx opens underline sql transaction and return wrapped instance
func (p *Postgres) OpenTx(ctx context.Context) (*TxSQLAdapter, error) {
	return p.openTx(ctx, p)
}

func (p *Postgres) createSchemaIfNotExists(ctx context.Context, schema string) error {
	if schema == "" {
		return nil
	}
	n := p.NamespaceName(schema)
	if n == "" {
		return nil
	}
	query := fmt.Sprintf(pgCreateDbSchemaIfNotExistsTemplate, n)

	if _, err := p.txOrDb(ctx).ExecContext(ctx, query); err != nil {
		return errorj.CreateSchemaError.Wrap(err, "failed to create db schema").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Schema:    n,
				Statement: query,
			})
	}
	return nil
}

// InitDatabase creates database schema instance if doesn't exist
func (p *Postgres) InitDatabase(ctx context.Context) error {
	_ = p.createSchemaIfNotExists(ctx, p.config.Schema)

	return nil
}

// GetTableSchema returns table (name,columns with name and types) representation wrapped in Table struct
func (p *Postgres) GetTableSchema(ctx context.Context, namespace string, tableName string) (*Table, error) {
	table, err := p.getTable(ctx, namespace, tableName)
	if err != nil {
		return nil, err
	}

	//don't select primary keys of non-existent table
	if table.ColumnsCount() == 0 {
		return table, nil
	}

	primaryKeyName, pkFields, err := p.getPrimaryKey(ctx, namespace, tableName)
	if err != nil {
		return nil, err
	}

	table.PKFields = pkFields
	table.PrimaryKeyName = primaryKeyName

	if primaryKeyName != "" && !strings.HasPrefix(primaryKeyName, BulkerManagedPkConstraintPrefix) {
		p.Infof("table: %s has a primary key with name: %s that isn't managed by Jitsu. Custom primary key will be used in rows deduplication and updates. primary_key configuration provided in Jitsu config will be ignored.", table.Name, primaryKeyName)
	}
	return table, nil
}

func (p *Postgres) getTable(ctx context.Context, namespace string, tableName string) (*Table, error) {
	tableName = p.TableName(tableName)
	namespace = p.NamespaceName(namespace)
	table := &Table{Name: tableName, Namespace: namespace, Columns: NewColumns(0), PKFields: jsonorder.NewOrderedSet[string]()}
	rows, err := p.txOrDb(ctx).QueryContext(ctx, pgTableSchemaQuery, namespace, tableName)
	if err != nil {
		return nil, errorj.GetTableError.Wrap(err, "failed to get table columns").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Schema:      namespace,
				Table:       tableName,
				PrimaryKeys: table.GetPKFields(),
				Statement:   pgTableSchemaQuery,
				Values:      []any{p.config.Schema, tableName},
			})
	}

	defer rows.Close()
	for rows.Next() {
		var columnName, columnPostgresType string
		if err := rows.Scan(&columnName, &columnPostgresType); err != nil {
			return nil, errorj.GetTableError.Wrap(err, "failed to scan result").
				WithProperty(errorj.DBInfo, &types2.ErrorPayload{
					Schema:      namespace,
					Table:       tableName,
					PrimaryKeys: table.GetPKFields(),
					Statement:   pgTableSchemaQuery,
					Values:      []any{p.config.Schema, tableName},
				})
		}
		if columnPostgresType == "-" {
			//skip dropped postgres field
			continue
		}
		dt, _ := p.GetDataType(columnPostgresType)
		table.Columns.Set(columnName, types2.SQLColumn{Type: columnPostgresType, DataType: dt})
	}

	if err := rows.Err(); err != nil {
		return nil, errorj.GetTableError.Wrap(err, "failed read last row").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Schema:      namespace,
				Table:       tableName,
				PrimaryKeys: table.GetPKFields(),
				Statement:   pgTableSchemaQuery,
				Values:      []any{p.config.Schema, tableName},
			})
	}

	return table, nil
}

func (p *Postgres) Insert(ctx context.Context, table *Table, merge bool, objects ...types2.Object) error {
	if !merge {
		return p.insert(ctx, table, objects)
	} else {
		return p.insertOrMerge(ctx, table, objects, pgMergeQueryTemplate)
	}
}

func (p *Postgres) CopyTables(ctx context.Context, targetTable *Table, sourceTable *Table, mergeWindow int) (bulker.WarehouseState, error) {
	if mergeWindow <= 0 {
		return p.copy(ctx, targetTable, sourceTable)
	} else {
		return p.copyOrMerge(ctx, targetTable, sourceTable, pgBulkMergeQueryTemplate, "T", pgBulkMergeSourceAlias, mergeWindow)
	}
}

func (p *Postgres) LoadTable(ctx context.Context, targetTable *Table, loadSource *LoadSource) (state bulker.WarehouseState, err error) {
	quotedTableName := p.quotedTableName(targetTable.Name)
	qoutedNamespace := p.namespacePrefix(targetTable.Namespace)
	if loadSource.Type != LocalFile {
		return state, fmt.Errorf("LoadTable: only local file is supported")
	}
	if loadSource.Format != p.batchFileFormat {
		return state, fmt.Errorf("LoadTable: only %s format is supported", p.batchFileFormat)
	}
	columnNames := targetTable.MappedColumnNames(p.quotedColumnName)
	var placeholdersBuilder strings.Builder
	args := make([]any, 0, targetTable.ColumnsCount())
	file, err := os.Open(loadSource.Path)
	if err != nil {
		return state, err
	}
	defer func() {
		_ = file.Close()
	}()
	decoder := jsoniter.NewDecoder(file)
	decoder.UseNumber()
	paramIdx := 1
	paramsLimit := 65535 - targetTable.ColumnsCount() //65535 is max number of parameters in postgres query
	prepareTime := time.Now()
main:
	for {
		for k := 0; k < paramsLimit; {
			var object map[string]any
			err = decoder.Decode(&object)
			if err != nil {
				if err == io.EOF {
					break main
				}
				return state, err
			}
			placeholdersBuilder.WriteString(",(")
			targetTable.Columns.ForEachIndexed(func(i int, v string, col types2.SQLColumn) {
				val, ok := object[v]
				if ok {
					val, _ = types2.ReformatValue(val)
				}
				if i > 0 {
					placeholdersBuilder.WriteString(",")
				}
				placeholdersBuilder.WriteString(p.typecastFunc(p.parameterPlaceholder(paramIdx, columnNames[i]), col))
				args = append(args, p.valueMappingFunction(val, ok, col))
				paramIdx++
				k++
			})
			placeholdersBuilder.WriteString(")")
		}
		state.Merge(bulker.WarehouseState{
			Name:            "postgres_prepare_data",
			TimeProcessedMs: time.Since(prepareTime).Milliseconds(),
		})
		if len(args) > 0 {
			loadTime := time.Now()
			copyStatement := fmt.Sprintf(pgLoadStatement, qoutedNamespace, quotedTableName, strings.Join(columnNames, ", "), placeholdersBuilder.String()[1:])
			if _, err := p.txOrDb(ctx).ExecContext(ctx, copyStatement, args...); err != nil {
				return state, checkErr(err)
			}
			state.Merge(bulker.WarehouseState{
				Name:            "postgres_load_data",
				TimeProcessedMs: time.Since(loadTime).Milliseconds(),
			})
		}
		prepareTime = time.Now()
		paramIdx = 1
		placeholdersBuilder.Reset()
		args = args[:0]
	}
	state.Merge(bulker.WarehouseState{
		Name:            "postgres_prepare_data",
		TimeProcessedMs: time.Since(prepareTime).Milliseconds(),
	})
	if len(args) > 0 {
		loadTime := time.Now()
		copyStatement := fmt.Sprintf(pgLoadStatement, qoutedNamespace, quotedTableName, strings.Join(columnNames, ", "), placeholdersBuilder.String()[1:])
		if _, err := p.txOrDb(ctx).ExecContext(ctx, copyStatement, args...); err != nil {
			return state, checkErr(err)
		}
		state.Merge(bulker.WarehouseState{
			Name:            "postgres_load_data",
			TimeProcessedMs: time.Since(loadTime).Milliseconds(),
		})
	}
	return state, nil
}

// pgColumnDDL returns column DDL (quoted column name, mapped sql type and 'not null' if pk field)
func pgColumnDDL(quotedName, name string, table *Table, column types2.SQLColumn) string {
	var notNullClause string
	sqlType := column.GetDDLType()

	//not null
	if table.PKFields.Contains(name) {
		notNullClause = " not null " + getDefaultValueStatement(sqlType)
	}

	return fmt.Sprintf(`%s %s%s`, quotedName, sqlType, notNullClause)
}

// return default value statement for creating column
func getDefaultValueStatement(sqlType string) string {
	sqlType = strings.ToLower(sqlType)
	//get default value based on type
	if strings.Contains(sqlType, "var") || strings.Contains(sqlType, "text") {
		return "default ''"
	}
	if strings.Contains(sqlType, "timestamp") {
		return "default CURRENT_TIMESTAMP"
	}
	if strings.Contains(sqlType, "boolean") {
		return "default false"
	}
	return "default 0"
}

// getPrimaryKey returns primary key name and fields
func (p *Postgres) getPrimaryKey(ctx context.Context, namespace string, tableName string) (string, jsonorder.OrderedSet[string], error) {
	tableName = p.TableName(tableName)
	namespace = p.NamespaceName(namespace)
	primaryKeys := jsonorder.NewOrderedSet[string]()
	pkFieldsRows, err := p.txOrDb(ctx).QueryContext(ctx, pgPrimaryKeyFieldsQuery, namespace, tableName)
	if err != nil {
		return "", jsonorder.OrderedSet[string]{}, errorj.GetPrimaryKeysError.Wrap(err, "failed to get primary key").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Schema:    namespace,
				Table:     tableName,
				Statement: pgPrimaryKeyFieldsQuery,
				Values:    []any{p.config.Schema, tableName},
			})
	}

	defer pkFieldsRows.Close()
	var pkFields []string
	var primaryKeyName string
	for pkFieldsRows.Next() {
		var constraintName, keyColumn string
		if err := pkFieldsRows.Scan(&constraintName, &keyColumn); err != nil {
			return "", jsonorder.OrderedSet[string]{}, errorj.GetPrimaryKeysError.Wrap(err, "failed to scan result").
				WithProperty(errorj.DBInfo, &types2.ErrorPayload{
					Schema:    namespace,
					Table:     tableName,
					Statement: pgPrimaryKeyFieldsQuery,
					Values:    []any{p.config.Schema, tableName},
				})
		}
		if primaryKeyName == "" && constraintName != "" {
			primaryKeyName = constraintName
		}

		pkFields = append(pkFields, keyColumn)
	}

	if err := pkFieldsRows.Err(); err != nil {
		return "", jsonorder.OrderedSet[string]{}, errorj.GetPrimaryKeysError.Wrap(err, "failed read last row").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Schema:    namespace,
				Table:     tableName,
				Statement: pgPrimaryKeyFieldsQuery,
				Values:    []any{p.config.Schema, tableName},
			})
	}

	primaryKeys.PutAll(pkFields)

	return primaryKeyName, primaryKeys, nil
}

func (p *Postgres) CreateTable(ctx context.Context, schemaToCreate *Table) (*Table, error) {
	err := p.createSchemaIfNotExists(ctx, schemaToCreate.Namespace)
	if err != nil {
		return nil, err
	}
	err = p.SQLAdapterBase.CreateTable(ctx, schemaToCreate)
	if err != nil {
		return nil, err
	}
	if !schemaToCreate.Temporary && schemaToCreate.TimestampColumn != "" {
		err = p.createIndex(ctx, schemaToCreate)
		if err != nil {
			p.DropTable(ctx, schemaToCreate.Namespace, schemaToCreate.Name, true)
			return nil, fmt.Errorf("failed to create sort key: %v", err)
		}
	}
	return schemaToCreate, nil
}

func (p *Postgres) ReplaceTable(ctx context.Context, targetTableName string, replacementTable *Table, dropOldTable bool) (err error) {
	targetTable := replacementTable.Clone()
	targetTable.Name = targetTableName
	if !targetTable.PKFields.Empty() {
		targetTable.PrimaryKeyName = BuildConstraintName(targetTableName)
	}
	_, err = p.tableHelper.EnsureTableWithoutCaching(ctx, p, p.ID, targetTable)
	if err != nil {
		return err
	}
	err = p.TruncateTable(ctx, replacementTable.Namespace, targetTableName)
	if err != nil {
		return err
	}
	_, err = p.CopyTables(ctx, targetTable, replacementTable, 0)
	if err != nil {
		return err
	}
	if dropOldTable {
		err = p.DropTable(ctx, replacementTable.Namespace, replacementTable.Name, true)
		if err != nil {
			return err
		}
	}
	return
}

func (p *Postgres) createIndex(ctx context.Context, table *Table) error {
	if table.TimestampColumn == "" {
		return nil
	}
	quotedTableName := p.quotedTableName(table.Name)
	quotedSchema := p.namespacePrefix(table.Namespace)

	statement := fmt.Sprintf(pgCreateIndexTemplate, quotedSchema,
		quotedTableName, p.quotedColumnName(table.TimestampColumn))

	if _, err := p.txOrDb(ctx).ExecContext(ctx, statement); err != nil {
		return errorj.AlterTableError.Wrap(err, "failed to set sort key").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Table:       quotedTableName,
				Schema:      quotedSchema,
				PrimaryKeys: table.GetPKFields(),
				Statement:   statement,
			})
	}

	return nil
}
func (p *Postgres) Ping(ctx context.Context) error {
	err := p.SQLAdapterBase.Ping(ctx)
	if err != nil {
		return err
	}
	return nil
}

//func (p *Postgres) TmpNamespace(namespace string) string {
//	return NoNamespaceValue
//}

// Close underlying sql.DB
func (p *Postgres) Close() error {
	if p.tmpDir != "" {
		if err := os.RemoveAll(p.tmpDir); err != nil {
			logging.Errorf("failed to remove tmp dir '%s': %v", p.tmpDir, err)
		}
	}
	return p.SQLAdapterBase.Close()
}

const (
	SSLModeRequire    string = "require"
	SSLModeDisable    string = "disable"
	SSLModeVerifyCA   string = "verify-ca"
	SSLModeVerifyFull string = "verify-full"

	SSLModeNotProvided string = ""
)

// SSLConfig is a dto for deserialized SSL configuration for Postgres
type SSLConfig struct {
	SSLMode       string `mapstructure:"sslMode,omitempty"`
	SSLServerCA   string `mapstructure:"sslServerCA,omitempty"`
	SSLClientCert string `mapstructure:"sslClientCert,omitempty"`
	SSLClientKey  string `mapstructure:"sslClientKey,omitempty"`
}

// ValidateSSL returns err if the ssl configuration is invalid
func (sc *SSLConfig) ValidateSSL() error {
	if sc == nil {
		return fmt.Errorf("ssl config is required")
	}

	if sc.SSLMode == SSLModeVerifyCA || sc.SSLMode == SSLModeVerifyFull {
		if sc.SSLServerCA == "" {
			return fmt.Errorf("'sslServerCA' is required parameter for sslMode '%s'", sc.SSLMode)
		}

		if sc.SSLClientCert == "" {
			return fmt.Errorf("'sslClientCert' is required parameter for sslMode '%s'", sc.SSLMode)
		}

		if sc.SSLClientKey == "" {
			return fmt.Errorf("'sslClientKey' is required parameter for sslMode '%s'", sc.SSLMode)
		}
	}

	return nil
}

// ProcessSSL serializes SSL payload (ca, client cert, key) into files
// enriches input DataSourceConfig parameters with SSL config
// ssl configuration might be file path as well as string content
func ProcessSSL(dir string, dsc *PostgresConfig) error {
	dsc.ValidateSSL()

	if dsc.SSLMode == SSLModeNotProvided {
		//default driver ssl mode
		return nil
	}

	dsc.Parameters["sslmode"] = dsc.SSLMode

	switch dsc.SSLMode {
	case SSLModeRequire, SSLModeDisable:
		//other parameters aren't required for 'disable' and 'require' mode
		return nil
	case SSLModeVerifyCA, SSLModeVerifyFull:
		serverCAPath, err := getSSLFilePath("server_ca", dir, dsc.SSLServerCA)
		if err != nil {
			return fmt.Errorf("error saving server_ca: %v", err)
		}
		dsc.Parameters["sslrootcert"] = serverCAPath

		clientCertPath, err := getSSLFilePath("client_cert", dir, dsc.SSLClientCert)
		if err != nil {
			return fmt.Errorf("error saving client_cert: %v", err)
		}
		dsc.Parameters["sslcert"] = clientCertPath

		clientKeyPath, err := getSSLFilePath("client_key", dir, dsc.SSLClientKey)
		if err != nil {
			return fmt.Errorf("error saving client_key: %v", err)
		}
		dsc.Parameters["sslkey"] = clientKeyPath
	default:
		return fmt.Errorf("unsupported ssl mode: %s", dsc.SSLMode)
	}
	return nil
}

// getSSLFilePath checks if input payload is filepath - returns it
// otherwise write payload as a file and returns abs file path
func getSSLFilePath(name, dir, payload string) (string, error) {
	if path.IsAbs(payload) {
		return payload, nil
	}

	filepath := path.Join(dir, name)
	err := os.WriteFile(filepath, []byte(payload), 0600)
	return filepath, err
}
