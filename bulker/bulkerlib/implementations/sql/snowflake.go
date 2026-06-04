package sql

import (
	"context"
	"crypto/rsa"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path"
	"regexp"
	"strconv"
	"strings"
	"text/template"
	"time"

	"github.com/hashicorp/go-multierror"
	bulker "github.com/jitsucom/bulker/bulkerlib"
	types2 "github.com/jitsucom/bulker/bulkerlib/types"
	"github.com/jitsucom/bulker/jitsubase/errorj"
	"github.com/jitsucom/bulker/jitsubase/jsonorder"
	"github.com/jitsucom/bulker/jitsubase/logging"
	"github.com/jitsucom/bulker/jitsubase/timestamp"
	"github.com/jitsucom/bulker/jitsubase/types"
	"github.com/jitsucom/bulker/jitsubase/utils"

	sf "github.com/snowflakedb/gosnowflake"
)

func init() {
	bulker.RegisterBulker(SnowflakeBulkerTypeId, NewSnowflake)
}

const (
	SnowflakeBulkerTypeId = "snowflake"

	sfTableExistenceQuery        = `SELECT count(*) from INFORMATION_SCHEMA.COLUMNS where TABLE_SCHEMA = ? and TABLE_NAME = ?`
	sfDescTableQuery             = `desc table %s%s`
	sfAlterClusteringKeyTemplate = `ALTER TABLE %s%s CLUSTER BY (TO_DATE(%s))`

	sfCopyStatement = `COPY INTO %s%s (%s) from @~/%s FILE_FORMAT=(TYPE= 'CSV', FIELD_OPTIONALLY_ENCLOSED_BY = '"' ESCAPE_UNENCLOSED_FIELD = NONE SKIP_HEADER = 1) `

	// Three-statement split that replaces a single MERGE INTO for Snowflake.
	// Stage 1 materializes the deduplicated source into a TEMPORARY table so
	// stages 2 and 3 read a much smaller, pre-deduped relation. Each stage
	// emits its own WarehouseState so timing for dedup/update/insert is
	// visible in the run report.
	sfDedupStatement       = `CREATE OR REPLACE TEMPORARY TABLE {{.NamespaceFrom}}{{.DedupTable}} AS SELECT {{.Columns}} FROM (SELECT {{.Columns}}, ROW_NUMBER() OVER (PARTITION BY {{.PrimaryKeyColumns}}{{.Discriminator}}) rn FROM {{.NamespaceFrom}}{{.TableFrom}}) QUALIFY rn = MAX(rn) OVER (PARTITION BY {{.PrimaryKeyColumns}})`
	sfMergeUpdateStatement = `UPDATE {{.Namespace}}{{.TableTo}} T SET {{.UpdateSet}} FROM {{.NamespaceFrom}}{{.DedupTable}} S WHERE {{.JoinConditions}}`
	sfMergeInsertStatement = `INSERT INTO {{.Namespace}}{{.TableTo}} ({{.Columns}}) SELECT {{.SourceColumns}} FROM {{.NamespaceFrom}}{{.DedupTable}} S WHERE NOT EXISTS (SELECT 1 FROM {{.Namespace}}{{.TableTo}} T WHERE {{.JoinConditions}})`
	sfDropDedupStatement   = `DROP TABLE IF EXISTS {{.NamespaceFrom}}{{.DedupTable}}`

	sfCreateSchemaIfNotExistsTemplate = `CREATE SCHEMA IF NOT EXISTS %s`

	sfPrimaryKeyFieldsQuery = `show primary keys in %s%s`

	sfReplaceTableTemplate = `CREATE OR REPLACE TABLE %s%s CLONE %s%s`
)

var (
	sfReservedWords       = []string{"all", "alter", "and", "any", "as", "between", "by", "case", "cast", "check", "column", "connect", "constraint", "create", "cross", "current", "current_date", "current_time", "current_timestamp", "current_user", "default", "delete", "distinct", "drop", "else", "exists", "false", "following", "for", "from", "full", "grant", "group", "having", "ilike", "in", "increment", "inner", "insert", "intersect", "into", "is", "join", "lateral", "left", "like", "localtime", "localtimestamp", "minus", "natural", "not", "null", "of", "on", "or", "order", "qualify", "regexp", "revoke", "right", "rlike", "row", "rows", "sample", "select", "set", "some", "start", "table", "tablesample", "then", "to", "trigger", "true", "try_cast", "union", "unique", "update", "using", "values", "when", "whenever", "where", "with"}
	sfReservedColumnNames = []string{"constraint", "current_date", "current_time", "current_timestamp", "current_user", "localtime", "localtimestamp"}

	sfReservedWordsSet          = types.NewSet(sfReservedWords...)
	sfReservedColumnNamesSet    = types.NewSet(sfReservedColumnNames...)
	sfUnquotedIdentifierPattern = regexp.MustCompile(`^[a-z_][0-9a-z_]*$|^[A-Z_][0-9A-Z_]*$`)

	sfDedupQueryTemplate, _       = template.New("snowflakeDedupQuery").Parse(sfDedupStatement)
	sfMergeUpdateQueryTemplate, _ = template.New("snowflakeMergeUpdateQuery").Parse(sfMergeUpdateStatement)
	sfMergeInsertQueryTemplate, _ = template.New("snowflakeMergeInsertQuery").Parse(sfMergeInsertStatement)
	sfDropDedupQueryTemplate, _   = template.New("snowflakeDropDedupQuery").Parse(sfDropDedupStatement)

	snowflakeTypes = map[types2.DataType][]string{
		types2.STRING:    {"text", "VARCHAR(16777216)", "VARCHAR"},
		types2.INT64:     {"bigint", "NUMBER(38,0)", "NUMBER"},
		types2.FLOAT64:   {"double precision", "FLOAT"},
		types2.TIMESTAMP: {"TIMESTAMP_TZ(6)", "timestamp(6)", "TIMESTAMP_NTZ(6)", "TIMESTAMP"},
		types2.BOOL:      {"boolean", "BOOLEAN"},
		types2.JSON:      {"text", "VARCHAR(16777216)"},
		types2.UNKNOWN:   {"text", "VARCHAR(16777216)"},
	}
)

// SnowflakeConfig dto for deserialized datasource config for Snowflake
type SnowflakeConfig struct {
	Account    string             `mapstructure:"account,omitempty" json:"account,omitempty" yaml:"account,omitempty"`
	Port       int                `mapstructure:"port,omitempty" json:"port,omitempty" yaml:"port,omitempty"`
	Db         string             `mapstructure:"database,omitempty" json:"database,omitempty" yaml:"database,omitempty"`
	Schema     string             `mapstructure:"defaultSchema,omitempty" json:"defaultSchema,omitempty" yaml:"defaultSchema,omitempty"`
	Username   string             `mapstructure:"username,omitempty" json:"username,omitempty" yaml:"username,omitempty"`
	Password   string             `mapstructure:"password,omitempty" json:"password,omitempty" yaml:"password,omitempty"`
	Warehouse  string             `mapstructure:"warehouse,omitempty" json:"warehouse,omitempty" yaml:"warehouse,omitempty"`
	Parameters map[string]*string `mapstructure:"parameters,omitempty" json:"parameters,omitempty" yaml:"parameters,omitempty"`
	// AuthenticationMethod can be "password" or "key-pair"
	AuthenticationMethod string `mapstructure:"authenticationMethod,omitempty" json:"authenticationMethod,omitempty" yaml:"authenticationMethod,omitempty"`
	PrivateKey           string `mapstructure:"privateKey,omitempty" json:"privateKey,omitempty" yaml:"privateKey,omitempty"`
	PrivateKeyPassphrase string `mapstructure:"privateKeyPassphrase,omitempty" json:"privateKeyPassphrase,omitempty" yaml:"privateKeyPassphrase,omitempty"`
}

func init() {
	for _, word := range sfReservedWords {
		sfReservedWordsSet.Put(strings.ToUpper(word))
	}
	for _, word := range sfReservedColumnNames {
		sfReservedColumnNamesSet.Put(strings.ToUpper(word))
	}
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

	return nil
}

// Snowflake is adapter for creating,patching (schema or table), inserting data to snowflake
type Snowflake struct {
	*SQLAdapterBase[SnowflakeConfig]
}

func (s *Snowflake) Type() string {
	return SnowflakeBulkerTypeId
}

// NewSnowflake returns configured Snowflake adapter instance
func NewSnowflake(bulkerConfig bulker.Config) (bulker.Bulker, error) {
	config := &SnowflakeConfig{}
	if err := utils.ParseObject(bulkerConfig.DestinationConfig, config); err != nil {
		return nil, fmt.Errorf("failed to parse destination config: %v", err)
	}

	if config.Parameters == nil {
		config.Parameters = map[string]*string{}
	}
	minute := "60"
	utils.MapPutIfAbsent(config.Parameters, "loginTimeout", &minute)
	utils.MapPutIfAbsent(config.Parameters, "requestTimeout", &minute)
	utils.MapPutIfAbsent(config.Parameters, "clientTimeout", &minute)

	var rsaKey *rsa.PrivateKey
	if config.AuthenticationMethod == "key-pair" {
		pk, err := utils.ParsePrivateKey([]byte(config.PrivateKey), config.PrivateKeyPassphrase)
		if err != nil {
			return nil, fmt.Errorf("failed to parse private key: %v", err)
		}
		var ok bool
		rsaKey, ok = pk.(*rsa.PrivateKey)
		if !ok {
			return nil, fmt.Errorf("private key is not RSA")
		}
	}
	dbConnectFunction := func(ctx context.Context, config *SnowflakeConfig) (*sql.DB, error) {
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
		if config.AuthenticationMethod == "key-pair" {
			cfg.Authenticator = sf.AuthTypeJwt
			cfg.PrivateKey = rsaKey
			cfg.Password = ""
		}

		connectionString, err := sf.DSN(cfg)
		if err != nil {
			return nil, err
		}

		dataSource, err := sql.Open("snowflake", connectionString)
		if err != nil {
			return nil, err
		}

		if err := dataSource.PingContext(ctx); err != nil {
			dataSource.Close()
			return nil, err
		}
		dataSource.SetConnMaxIdleTime(3 * time.Minute)
		dataSource.SetMaxIdleConns(10)
		return dataSource, nil
	}
	typecastFunc := func(placeholder string, column types2.SQLColumn) string {
		if column.Override {
			return placeholder + "::" + column.Type
		}
		return placeholder
	}
	var queryLogger *logging.QueryLogger
	if bulkerConfig.LogLevel == bulker.Verbose {
		queryLogger = logging.NewQueryLogger(bulkerConfig.Id, os.Stderr, os.Stderr)
	}
	sqlAdapter, err := newSQLAdapterBase(bulkerConfig.Id, SnowflakeBulkerTypeId, config, config.Schema, dbConnectFunction, snowflakeTypes, queryLogger, typecastFunc, QuestionMarkParameterPlaceholder, sfColumnDDL, unmappedValue, checkErr, false)
	s := &Snowflake{sqlAdapter}
	s.doLocalDeduplication = false
	s.batchFileFormat = types2.FileFormatCSV
	s.batchFileCompression = types2.FileCompressionGZIP
	s.valueMappingFunction = func(value any, valuePresent bool, column types2.SQLColumn) any {
		if !valuePresent {
			return nil
		}
		l := strings.ToLower(column.Type)
		if _, ok := value.(time.Time); ok && strings.Contains(l, "timestamp") {
			return value.(time.Time).Format(time.RFC3339Nano)
		}
		return value
	}

	s.tableHelper = NewTableHelper(SnowflakeBulkerTypeId, 255, '"')
	s.tableHelper.tableNameFunc = sfIdentifierFunction
	s.tableHelper.columnNameFunc = sfIdentifierFunction
	return s, err
}
func (s *Snowflake) CreateStream(id, tableName string, mode bulker.BulkMode, streamOptions ...bulker.StreamOption) (bulker.BulkerStream, error) {
	streamOptions = append(streamOptions, withLocalBatchFile(fmt.Sprintf("bulker_%s", utils.SanitizeString(id))))

	if err := s.validateOptions(streamOptions); err != nil {
		return nil, err
	}
	switch mode {
	case bulker.Stream:
		return newAutoCommitStream(id, s, tableName, streamOptions...)
	case bulker.Batch:
		return newTransactionalStream(id, s, tableName, streamOptions...)
	case bulker.ReplaceTable:
		return newReplaceTableStream(id, s, tableName, streamOptions...)
	case bulker.ReplacePartition:
		return newReplacePartitionStream(id, s, tableName, streamOptions...)
	}
	return nil, fmt.Errorf("unsupported bulk mode: %s", mode)
}

func (s *Snowflake) validateOptions(streamOptions []bulker.StreamOption) error {
	options := &bulker.StreamOptions{}
	for _, option := range streamOptions {
		options.Add(option)
	}
	return nil
}

// OpenTx opens underline sql transaction and return wrapped instance
func (s *Snowflake) OpenTx(ctx context.Context) (*TxSQLAdapter, error) {
	return s.openTx(ctx, s)
}

func (s *Snowflake) createSchemaIfNotExists(ctx context.Context, schema string) error {
	if schema == "" {
		return nil
	}
	schema = s.NamespaceName(schema)
	if schema == "" {
		return nil
	}
	query := fmt.Sprintf(sfCreateSchemaIfNotExistsTemplate, schema)

	if _, err := s.txOrDb(ctx).ExecContext(ctx, query); err != nil {
		err = checkErr(err)

		return errorj.CreateSchemaError.Wrap(err, "failed to create db schema").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Schema:    schema,
				Statement: query,
			})
	}
	return nil
}

// InitDatabase create database schema instance if doesn't exist
func (s *Snowflake) InitDatabase(ctx context.Context) error {
	return s.createSchemaIfNotExists(ctx, s.config.Schema)
}

// GetTableSchema returns table (name,columns with name and types) representation wrapped in Table struct
func (s *Snowflake) GetTableSchema(ctx context.Context, namespace string, tableName string) (*Table, error) {
	quotedTableName, tableName := s.tableHelper.adaptTableName(tableName)
	namespace = s.NamespaceName(namespace)
	table := &Table{Name: tableName, Namespace: namespace, Columns: NewColumns(0), PKFields: jsonorder.NewOrderedSet[string]()}

	query := fmt.Sprintf(sfDescTableQuery, s.namespacePrefix(namespace), quotedTableName)
	rows, err := s.txOrDb(ctx).QueryContext(ctx, query)
	if err != nil {
		if strings.Contains(err.Error(), "does not exist") {
			return table, nil
		}
		return nil, errorj.GetTableError.Wrap(err, "failed to get table columns").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Schema:    s.config.Schema,
				Table:     quotedTableName,
				Statement: query,
			})
	}
	defer rows.Close()

	for rows.Next() {
		var row map[string]any
		row, err = rowToMap(rows)
		if err != nil {
			return nil, errorj.GetTableError.Wrap(err, "failed to scan result").
				WithProperty(errorj.DBInfo, &types2.ErrorPayload{
					Schema:    s.config.Schema,
					Table:     quotedTableName,
					Statement: query,
				})
		}

		columnName := fmt.Sprint(row["name"])
		columnSnowflakeType := fmt.Sprint(row["type"])
		dt, _ := s.GetDataType(columnSnowflakeType)
		table.Columns.Set(columnName, types2.SQLColumn{Type: columnSnowflakeType, DataType: dt})
	}
	if err := rows.Err(); err != nil {
		return nil, errorj.GetTableError.Wrap(err, "failed read last row").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Schema:    s.config.Schema,
				Table:     quotedTableName,
				Statement: query,
			})
	}

	if table.ColumnsCount() == 0 {
		return table, nil
	}

	primaryKeyName, pkFields, err := s.getPrimaryKey(ctx, namespace, tableName)
	if err != nil {
		return nil, err
	}

	table.PKFields = pkFields
	table.PrimaryKeyName = primaryKeyName

	if primaryKeyName != "" && !strings.HasPrefix(strings.ToLower(primaryKeyName), BulkerManagedPkConstraintPrefix) {
		s.Infof("table: %s has a primary key with name: %s that isn't managed by Jitsu. Custom primary key will be used in rows deduplication and updates. primary_key configuration provided in Jitsu config will be ignored.", table.Name, primaryKeyName)
	}

	return table, nil
}

// getPrimaryKey returns primary key name and fields
func (s *Snowflake) getPrimaryKey(ctx context.Context, namespace, tableName string) (string, jsonorder.OrderedSet[string], error) {
	quotedTableName := s.quotedTableName(tableName)

	primaryKeys := jsonorder.NewOrderedSet[string]()
	statement := fmt.Sprintf(sfPrimaryKeyFieldsQuery, s.namespacePrefix(namespace), quotedTableName)
	pkFieldsRows, err := s.txOrDb(ctx).QueryContext(ctx, statement)
	if err != nil {
		return "", jsonorder.OrderedSet[string]{}, errorj.GetPrimaryKeysError.Wrap(err, "failed to get primary key").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Schema:    namespace,
				Table:     quotedTableName,
				Statement: statement,
			})
	}

	defer pkFieldsRows.Close()
	pkFields := map[int]string{}
	var primaryKeyName string
	for pkFieldsRows.Next() {
		var row map[string]any
		row, err = rowToMap(pkFieldsRows)
		if err != nil {
			return "", jsonorder.OrderedSet[string]{}, errorj.GetPrimaryKeysError.Wrap(err, "failed to get primary key").
				WithProperty(errorj.DBInfo, &types2.ErrorPayload{
					Schema:    namespace,
					Table:     quotedTableName,
					Statement: statement,
				})
		}
		constraintName, ok := row["constraint_name"].(string)
		if primaryKeyName == "" && ok {
			primaryKeyName = constraintName
		}
		keyColumn, ok := row["column_name"].(string)
		if ok && keyColumn != "" {
			seqColumn, ok := row["key_sequence"].(string)
			if ok && seqColumn != "" {
				atoi, err := strconv.Atoi(seqColumn)
				if err != nil {
					s.Errorf("failed to parse primary key sequence: %v", seqColumn)
				} else if atoi > 0 {
					pkFields[atoi-1] = keyColumn
				}
			}
		}
	}

	if err := pkFieldsRows.Err(); err != nil {
		return "", jsonorder.OrderedSet[string]{}, errorj.GetPrimaryKeysError.Wrap(err, "failed read last row").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Schema:    namespace,
				Table:     quotedTableName,
				Statement: statement,
			})
	}

	l := len(pkFields)
	for i := 0; i < l; i++ {
		primaryKeys.Put(pkFields[i])
	}

	return primaryKeyName, primaryKeys, nil
}

// LoadTable transfer data from local file to Snowflake by passing COPY request to Snowflake
func (s *Snowflake) LoadTable(ctx context.Context, targetTable *Table, loadSource *LoadSource) (state bulker.WarehouseState, err error) {
	quotedTableName := s.quotedTableName(targetTable.Name)
	namespacePrefix := s.namespacePrefix(targetTable.Namespace)
	if loadSource.Type != LocalFile {
		return state, fmt.Errorf("LoadTable: only local file is supported")
	}
	if loadSource.Format != s.batchFileFormat {
		return state, fmt.Errorf("LoadTable: only %s format is supported", s.batchFileFormat)
	}
	startTime := time.Now()
	putStatement := fmt.Sprintf("PUT file://%s @~", loadSource.Path)
	if _, err = s.txOrDb(ctx).ExecContext(ctx, putStatement); err != nil {
		return state, errorj.LoadError.Wrap(err, "failed to put file to stage").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Schema:    s.config.Schema,
				Table:     quotedTableName,
				Statement: putStatement,
			})
	}
	state = bulker.WarehouseState{
		Name:            "stage_put",
		TimeProcessedMs: time.Since(startTime).Milliseconds(),
	}
	startTime = time.Now()
	defer func() {
		removeStatement := fmt.Sprintf("REMOVE @~/%s", path.Base(loadSource.Path))
		if _, err2 := s.txOrDb(ctx).ExecContext(ctx, removeStatement); err2 != nil {
			err2 = errorj.LoadError.Wrap(err, "failed to remove file from stage").
				WithProperty(errorj.DBInfo, &types2.ErrorPayload{
					Schema:    s.config.Schema,
					Table:     quotedTableName,
					Statement: putStatement,
				})
			err = multierror.Append(err, err2)
		}
		state.Merge(bulker.WarehouseState{
			Name:            "copy_from_stage",
			TimeProcessedMs: time.Since(startTime).Milliseconds(),
		})
	}()
	columnNames := targetTable.MappedColumnNames(s.quotedColumnName)
	statement := fmt.Sprintf(sfCopyStatement, namespacePrefix, quotedTableName, strings.Join(columnNames, ","), path.Base(loadSource.Path))

	if _, err := s.txOrDb(ctx).ExecContext(ctx, statement); err != nil {
		return state, errorj.CopyError.Wrap(err, "failed to copy data from stage").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Schema:    targetTable.Namespace,
				Table:     quotedTableName,
				Statement: statement,
			})
	}

	return state, nil
}

// Insert inserts data with InsertContext as a single object or a batch into Snowflake
func (s *Snowflake) Insert(ctx context.Context, table *Table, merge bool, objects ...types2.Object) error {
	if !merge || len(table.GetPKFields()) == 0 {
		return s.insert(ctx, table, objects)
	}
	for _, object := range objects {
		pkMatchConditions := &WhenConditions{}
		for _, pkColumn := range table.GetPKFields() {
			value := object.GetN(pkColumn)
			if value == nil {
				pkMatchConditions = pkMatchConditions.Add(pkColumn, "IS NULL", nil)
			} else {
				pkMatchConditions = pkMatchConditions.Add(pkColumn, "=", value)
			}
		}
		res, err := s.SQLAdapterBase.Select(ctx, table.Namespace, table.Name, pkMatchConditions, nil)
		if err != nil {
			return errorj.ExecuteInsertError.Wrap(err, "failed check primary key collision").
				WithProperty(errorj.DBInfo, &types2.ErrorPayload{
					Schema:      s.config.Schema,
					Table:       table.Name,
					PrimaryKeys: table.GetPKFields(),
				})
		}
		if len(res) > 0 {
			return s.Update(ctx, table, object, pkMatchConditions)
		} else {
			return s.insert(ctx, table, []types2.Object{object})
		}
	}
	return nil
}

func (s *Snowflake) CopyTables(ctx context.Context, targetTable *Table, sourceTable *Table, mergeWindow int, discriminatorColumn string) (bulker.WarehouseState, error) {
	if mergeWindow <= 0 {
		return s.copy(ctx, targetTable, sourceTable)
	}
	hasDiscriminatorColumn := false
	if discriminatorColumn != "" {
		_, hasDiscriminatorColumn = sourceTable.Columns.Get(discriminatorColumn)
	}
	discriminator := utils.Ternary(hasDiscriminatorColumn, " ORDER BY "+s.quotedColumnName(discriminatorColumn)+" ASC", " ORDER BY 1")
	return s.copyOrMergeSplit(ctx, targetTable, sourceTable, mergeWindow, discriminator)
}

// copyOrMergeSplit replaces the single MERGE INTO with three sequential
// statements: pre-materialize a deduplicated view of the source into
// {sourceTable}_DEDUP, UPDATE matched rows in the target, then INSERT the
// rest. Each stage's duration is reported as a separate WarehouseState so
// callers see where the time actually goes.
//
// Why split:
//   - Dedup-once: stages 2 and 3 both read from a small pre-deduped relation
//     instead of re-running the QUALIFY subquery against the full tmp table
//     for each pass.
//   - Date-list scoping: after dedup is materialized we can query its actual
//     TO_DATE(timestamp) values and pin the target scan in UPDATE/INSERT to
//     those exact dates (sfMergeUpdateStatement/sfMergeInsertStatement),
//     which lines up with the target's TO_DATE(timestamp) clustering key and
//     prunes target micro-partitions precisely — the dominant win when
//     mergeWindow expands to a year because of one late event.
//
// Order matters: UPDATE first, then INSERT. If INSERT ran first, freshly
// inserted rows would match in the subsequent UPDATE and re-write themselves
// with identical values, wasting micro-partition rewrites.
func (s *Snowflake) copyOrMergeSplit(ctx context.Context, targetTable *Table, sourceTable *Table, mergeWindow int, discriminator string) (state bulker.WarehouseState, err error) {
	columnNames := sourceTable.MappedColumnNames(s.quotedColumnName)
	count := sourceTable.ColumnsCount()
	updateColumns := make([]string, count)
	insertColumns := make([]string, count)
	sourceTable.Columns.ForEachIndexed(func(i int, _ string, col types2.SQLColumn) {
		colName := columnNames[i]
		updateColumns[i] = fmt.Sprintf(`%s=S.%s`, colName, colName)
		insertColumns[i] = s.typecastFunc(fmt.Sprintf(`S.%s`, colName), col)
	})

	var pkJoinConditions []string
	targetTable.PKFields.ForEach(func(pkField string) {
		pkName := s.quotedColumnName(pkField)
		pkJoinConditions = append(pkJoinConditions, fmt.Sprintf("T.%s = S.%s", pkName, pkName))
	})
	pkColumns := utils.ArrayMap(targetTable.GetPKFields(), s.quotedColumnName)

	payload := QueryPayload{
		Namespace:         s.namespacePrefix(targetTable.Namespace),
		NamespaceFrom:     s.namespacePrefix(sourceTable.Namespace),
		TableTo:           s.quotedTableName(targetTable.Name),
		TableFrom:         s.quotedTableName(sourceTable.Name),
		DedupTable:        s.quotedTableName(sourceTable.Name + "_DEDUP"),
		Columns:           strings.Join(columnNames, ","),
		PrimaryKeyName:    targetTable.PrimaryKeyName,
		PrimaryKeyColumns: strings.Join(pkColumns, ","),
		Discriminator:     discriminator,
		JoinConditions:    strings.Join(pkJoinConditions, " AND "),
		SourceColumns:     strings.Join(insertColumns, ", "),
		UpdateSet:         strings.Join(updateColumns, ","),
	}

	runStage := func(stageName string, tmpl *template.Template, errMsg string) error {
		startTime := time.Now()
		buf := strings.Builder{}
		if err := tmpl.Execute(&buf, payload); err != nil {
			return errorj.BulkMergeError.Wrap(err, "failed to build %s query from template", stageName)
		}
		statement := buf.String()
		if _, err := s.txOrDb(ctx).ExecContext(ctx, statement); err != nil {
			return errorj.BulkMergeError.Wrap(err, "%s", errMsg).
				WithProperty(errorj.DBInfo, &types2.ErrorPayload{
					Table:       payload.TableTo,
					PrimaryKeys: targetTable.GetPKFields(),
					Statement:   statement,
				})
		}
		state.Merge(bulker.WarehouseState{Name: stageName, TimeProcessedMs: time.Since(startTime).Milliseconds()})
		return nil
	}

	if err = runStage("dedup", sfDedupQueryTemplate, "failed to materialize dedup table"); err != nil {
		return state, err
	}

	// Best-effort cleanup. TEMPORARY tables drop at session end, but the
	// sidecar pool can reuse the same connection across many CopyTables
	// calls — dropping explicitly avoids name collisions on retry.
	defer func() {
		buf := strings.Builder{}
		if execErr := sfDropDedupQueryTemplate.Execute(&buf, payload); execErr != nil {
			logging.Warnf("failed to build drop dedup query: %v", execErr)
			return
		}
		if _, dropErr := s.txOrDb(ctx).ExecContext(ctx, buf.String()); dropErr != nil {
			logging.Warnf("failed to drop dedup table %s%s: %v", payload.NamespaceFrom, payload.DedupTable, dropErr)
		}
	}()

	// Pin the target-side scan to the actual dates present in the dedup batch.
	// The target table is clustered by TO_DATE(timestamp), so an IN-list over
	// the distinct dates in dedup prunes target micro-partitions exactly —
	// critical when mergeWindow expands to a year because of a late-arriving
	// event but the bulk of the batch is concentrated on a few days. If the
	// batch is genuinely dense across many days (or the lookup fails / there
	// is no timestamp column), fall back to the original mergeWindow-derived
	// range bound, which is at least as good as before.
	if targetTable.TimestampColumn != "" && mergeWindow > 0 {
		timestampColName := s.quotedColumnName(targetTable.TimestampColumn)
		startDate := timestamp.Now().AddDate(0, 0, -mergeWindow).UTC()
		var timeFilter string
		dates, dlErr := s.collectDedupDates(ctx, timestampColName, payload.NamespaceFrom, payload.DedupTable, startDate)
		if dlErr != nil {
			logging.Warnf("[snowflake] dedup date-list lookup failed, falling back to range bound: %v", dlErr)
		}
		if len(dates) > 0 {
			logging.Infof("[snowflake] merge date scope for %s%s: %d distinct date(s) in dedup batch", payload.Namespace, payload.TableTo, len(dates))
			timeFilter = fmt.Sprintf("TO_DATE(T.%s) IN (%s)", timestampColName, strings.Join(dates, ","))
		} else {
			logging.Infof("[snowflake] merge date scope for %s%s: range bound (T.%s >= %s)", payload.Namespace, payload.TableTo, timestampColName, startDate.Format(time.RFC3339))
			timeFilter = fmt.Sprintf("T.%s >= TO_TIMESTAMP_TZ('%s')", timestampColName, startDate.Format(time.RFC3339))
		}
		payload.JoinConditions = strings.Join(append(pkJoinConditions, timeFilter), " AND ")
	}

	if err = runStage("update", sfMergeUpdateQueryTemplate, "failed to update matched rows"); err != nil {
		return state, err
	}
	if err = runStage("insert", sfMergeInsertQueryTemplate, "failed to insert unmatched rows"); err != nil {
		return state, err
	}
	return state, nil
}

// collectDedupDates returns the quoted SQL date literals present in the
// dedup table, scoped to the [startDate, ∞) window the range bound
// would have allowed. There is no upper bound on the date set —
// future-dated events (clock skew, deliberately future-stamped
// messages) need to be in the IN-list so the UPDATE finds their T
// match and the INSERT's NOT EXISTS sees them; silently dropping those
// dates would create duplicates. Returns an empty slice (no error)
// when nothing matches and the caller should use the range bound.
func (s *Snowflake) collectDedupDates(ctx context.Context, quotedTsCol, namespacePrefix, quotedDedupTable string, startDate time.Time) ([]string, error) {
	query := fmt.Sprintf(
		`SELECT TO_DATE(%s) FROM %s%s WHERE %s IS NOT NULL AND TO_DATE(%s) >= TO_DATE('%s') GROUP BY 1 ORDER BY 1`,
		quotedTsCol, namespacePrefix, quotedDedupTable, quotedTsCol, quotedTsCol, startDate.Format("2006-01-02"),
	)
	rows, err := s.txOrDb(ctx).QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var parts []string
	for rows.Next() {
		var d time.Time
		if err := rows.Scan(&d); err != nil {
			return nil, err
		}
		parts = append(parts, "'"+d.Format("2006-01-02")+"'")
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return parts, nil
}

func (b *SQLAdapterBase[T]) replaceTable(ctx context.Context, namespace, targetTable, sourceTable string) error {
	quotedTargetTableName := b.quotedTableName(targetTable)
	quotedSourceTableName := b.quotedTableName(sourceTable)
	quotedSchema := b.namespacePrefix(namespace)
	query := fmt.Sprintf(sfReplaceTableTemplate, quotedSchema, quotedTargetTableName, quotedSchema, quotedSourceTableName)

	if _, err := b.txOrDb(ctx).ExecContext(ctx, query); err != nil {
		return errorj.RenameError.Wrap(err, "failed to replace table").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Table:     quotedTargetTableName,
				Statement: query,
			})
	}

	return nil
}

func (s *Snowflake) ReplaceTable(ctx context.Context, targetTableName string, replacementTable *Table, dropOldTable bool) (err error) {
	err = s.replaceTable(ctx, replacementTable.Namespace, targetTableName, replacementTable.Name)
	if dropOldTable && err == nil {
		return s.DropTable(ctx, replacementTable.Namespace, replacementTable.Name, true)
	} else if err != nil {
		return err
	}
	return
}

// columnDDLsfColumnDDL returns column DDL (column name, mapped sql type)
func sfColumnDDL(quotedName, _ string, _ *Table, column types2.SQLColumn) string {
	return fmt.Sprintf(`%s %s`, quotedName, column.GetDDLType())
}

func (s *Snowflake) Select(ctx context.Context, namespace string, tableName string, whenConditions *WhenConditions, orderBy []string) ([]map[string]any, error) {
	ctx = sf.WithHigherPrecision(ctx)
	return s.SQLAdapterBase.Select(ctx, namespace, tableName, whenConditions, orderBy)
}

func sfIdentifierFunction(value string, alphanumeric bool) (adapted string, needQuotes bool) {
	if sfReservedColumnNamesSet.Contains(value) {
		return "_" + strings.ToUpper(value), false
	}
	if sfReservedWordsSet.Contains(value) {
		return strings.ToUpper(value), true
	}
	if !alphanumeric || !utils.IsLetterOrUnderscore(int32(value[0])) || !sfUnquotedIdentifierPattern.MatchString(value) {
		return value, true
	} else {
		return strings.ToUpper(value), false
	}
}

func (s *Snowflake) CreateTable(ctx context.Context, schemaToCreate *Table) (*Table, error) {
	err := s.createSchemaIfNotExists(ctx, schemaToCreate.Namespace)
	if err != nil {
		return nil, err
	}
	err = s.SQLAdapterBase.CreateTable(ctx, schemaToCreate)
	if err != nil {
		return nil, err
	}
	if !schemaToCreate.Temporary && schemaToCreate.TimestampColumn != "" {
		err = s.createClusteringKey(ctx, schemaToCreate)
		if err != nil {
			s.DropTable(ctx, schemaToCreate.Namespace, schemaToCreate.Name, true)
			return nil, fmt.Errorf("failed to create sort key: %v", err)
		}
	}
	return schemaToCreate, nil
}

func (s *Snowflake) createClusteringKey(ctx context.Context, table *Table) error {
	if table.TimestampColumn == "" {
		return nil
	}
	quotedTableName := s.quotedTableName(table.Name)
	namespacePrefix := s.namespacePrefix(table.Namespace)
	statement := fmt.Sprintf(sfAlterClusteringKeyTemplate, namespacePrefix,
		quotedTableName, s.quotedColumnName(table.TimestampColumn))

	if _, err := s.txOrDb(ctx).ExecContext(ctx, statement); err != nil {
		return errorj.AlterTableError.Wrap(err, "failed to set clustering key").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Table:       quotedTableName,
				PrimaryKeys: table.GetPKFields(),
				Statement:   statement,
			})
	}

	return nil
}
