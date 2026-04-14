package sql

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"slices"
	"strings"
	"testing"
	"time"

	bulker "github.com/jitsucom/bulker/bulkerlib"
	testcontainers2 "github.com/jitsucom/bulker/bulkerlib/implementations/sql/testcontainers"
	"github.com/jitsucom/bulker/bulkerlib/implementations/sql/testcontainers/clickhouse"
	"github.com/jitsucom/bulker/bulkerlib/implementations/sql/testcontainers/clickhouse_noshards"
	types2 "github.com/jitsucom/bulker/bulkerlib/types"
	"github.com/jitsucom/bulker/jitsubase/jsonorder"
	"github.com/jitsucom/bulker/jitsubase/logging"
	"github.com/jitsucom/bulker/jitsubase/timestamp"
	"github.com/jitsucom/bulker/jitsubase/utils"
	"github.com/jitsucom/bulker/jitsubase/uuid"
	"github.com/stretchr/testify/require"
)

var constantTime = timestamp.MustParseTime(time.RFC3339Nano, "2022-08-18T14:17:22.375Z")
var constantTime2 = timestamp.MustParseTime(time.RFC3339Nano, "2022-08-18T15:17:22.375Z")

const forceLeaveResultingTables = false

var allBulkerConfigs = []string{BigqueryBulkerTypeId, RedshiftBulkerTypeId, RedshiftBulkerTypeId + "_iam", RedshiftBulkerTypeId + "_serverless", SnowflakeBulkerTypeId, PostgresBulkerTypeId,
	MySQLBulkerTypeId, ClickHouseBulkerTypeId, ClickHouseBulkerTypeId + "_cluster", ClickHouseBulkerTypeId + "_cluster_noshards", DuckDBBulkerTypeId}

var exceptBigquery []string

type TestConfig struct {
	//type of bulker destination
	BulkerType string
	//Config     destination config
	Config any
}

type StepFunction func(testConfig bulkerTestConfig, mode bulker.BulkMode) error

var configRegistry = map[string]TestConfig{}

type ExpectedTable struct {
	Name      string
	Namespace string
	PKFields  []string
	Columns   Columns
}

var postgresContainer *testcontainers2.PostgresContainer
var mysqlContainer *testcontainers2.MySQLContainer
var clickhouseContainer *testcontainers2.ClickHouseContainer
var clickhouseClusterContainer *clickhouse.ClickHouseClusterContainer
var clickhouseClusterContainerNoShards *clickhouse_noshards.ClickHouseClusterContainerNoShards

func init() {
	// uncomment to run tests locally with just one bulker type
	//allBulkerConfigs = []string{PostgresBulkerTypeId}

	if utils.ArrayContains(allBulkerConfigs, BigqueryBulkerTypeId) {
		bigqueryConfig := os.Getenv("BULKER_TEST_BIGQUERY")
		if bigqueryConfig != "" {
			configRegistry[BigqueryBulkerTypeId] = TestConfig{BulkerType: BigqueryBulkerTypeId, Config: bigqueryConfig}
		} else {
			allBulkerConfigs = utils.ArrayExcluding(allBulkerConfigs, BigqueryBulkerTypeId)
		}
	}

	if utils.ArrayContains(allBulkerConfigs, RedshiftBulkerTypeId) {
		redshiftConfig := os.Getenv("BULKER_TEST_REDSHIFT")
		if redshiftConfig != "" {
			configRegistry[RedshiftBulkerTypeId] = TestConfig{BulkerType: RedshiftBulkerTypeId, Config: redshiftConfig}
		} else {
			allBulkerConfigs = utils.ArrayExcluding(allBulkerConfigs, RedshiftBulkerTypeId)
		}
	}

	if utils.ArrayContains(allBulkerConfigs, RedshiftBulkerTypeId+"_serverless") {
		redshiftServerlessConfig := os.Getenv("BULKER_TEST_REDSHIFT_SERVERLESS")
		if redshiftServerlessConfig != "" {
			configRegistry[RedshiftBulkerTypeId+"_serverless"] = TestConfig{BulkerType: RedshiftBulkerTypeId, Config: redshiftServerlessConfig}
		} else {
			allBulkerConfigs = utils.ArrayExcluding(allBulkerConfigs, RedshiftBulkerTypeId+"_serverless")
		}
	}
	if utils.ArrayContains(allBulkerConfigs, RedshiftBulkerTypeId+"_iam") {
		redshiftServerlessConfig := os.Getenv("BULKER_TEST_REDSHIFT_IAM")
		if redshiftServerlessConfig != "" {
			configRegistry[RedshiftBulkerTypeId+"_iam"] = TestConfig{BulkerType: RedshiftBulkerTypeId, Config: redshiftServerlessConfig}
		} else {
			allBulkerConfigs = utils.ArrayExcluding(allBulkerConfigs, RedshiftBulkerTypeId+"_iam")
		}
	}

	if utils.ArrayContains(allBulkerConfigs, SnowflakeBulkerTypeId) {
		snowflakeConfig := os.Getenv("BULKER_TEST_SNOWFLAKE")
		if snowflakeConfig != "" {
			configRegistry[SnowflakeBulkerTypeId] = TestConfig{BulkerType: SnowflakeBulkerTypeId, Config: snowflakeConfig}
		} else {
			allBulkerConfigs = utils.ArrayExcluding(allBulkerConfigs, SnowflakeBulkerTypeId)
		}
	}
	var err error
	if utils.ArrayContains(allBulkerConfigs, PostgresBulkerTypeId) {
		postgresContainer, err = testcontainers2.NewPostgresContainer(context.Background())
		if err != nil {
			panic(err)
		}
		configRegistry[PostgresBulkerTypeId] = TestConfig{BulkerType: PostgresBulkerTypeId, Config: PostgresConfig{
			DataSourceConfig: DataSourceConfig{
				Host:       postgresContainer.Host,
				Port:       postgresContainer.Port,
				Username:   postgresContainer.Username,
				Password:   postgresContainer.Password,
				Db:         postgresContainer.Database,
				Schema:     postgresContainer.Schema,
				Parameters: map[string]string{"sslmode": "disable"},
			},
		}}
	}

	if utils.ArrayContains(allBulkerConfigs, MySQLBulkerTypeId) {
		mysqlContainer, err = testcontainers2.NewMySQLContainer(context.Background())
		if err != nil {
			panic(err)
		}
		configRegistry[MySQLBulkerTypeId] = TestConfig{BulkerType: MySQLBulkerTypeId, Config: DataSourceConfig{
			Host:       mysqlContainer.Host,
			Port:       mysqlContainer.Port,
			Username:   mysqlContainer.Username,
			Password:   mysqlContainer.Password,
			Db:         mysqlContainer.Database,
			Parameters: map[string]string{"tls": "false", "parseTime": "true"},
		}}
	}

	if utils.ArrayContains(allBulkerConfigs, DuckDBBulkerTypeId) {
		motherduckConfig := os.Getenv("BULKER_TEST_MOTHERDUCK")
		if motherduckConfig != "" {
			configRegistry[DuckDBBulkerTypeId] = TestConfig{BulkerType: DuckDBBulkerTypeId, Config: motherduckConfig}
		} else {
			allBulkerConfigs = utils.ArrayExcluding(allBulkerConfigs, DuckDBBulkerTypeId)
		}
	}

	if utils.ArrayContains(allBulkerConfigs, ClickHouseBulkerTypeId) {
		clickhouseContainer, err = testcontainers2.NewClickhouseContainer(context.Background())
		if err != nil {
			panic(err)
		}
		configRegistry[ClickHouseBulkerTypeId] = TestConfig{BulkerType: ClickHouseBulkerTypeId, Config: ClickHouseConfig{
			Hosts:    clickhouseContainer.Hosts,
			Username: "default",
			Database: clickhouseContainer.Database,
			Parameters: map[string]string{
				"enable_json_type": "1",
			},
		}}
	}

	if utils.ArrayContains(allBulkerConfigs, ClickHouseBulkerTypeId+"_cluster") {
		clickhouseClusterContainer, err = clickhouse.NewClickhouseClusterContainer(context.Background())
		if err != nil {
			panic(err)
		}
		configRegistry[ClickHouseBulkerTypeId+"_cluster"] = TestConfig{BulkerType: ClickHouseBulkerTypeId, Config: ClickHouseConfig{
			Hosts:    clickhouseClusterContainer.Hosts,
			Username: "default",
			Database: clickhouseClusterContainer.Database,
			Cluster:  clickhouseClusterContainer.Cluster,
		}}
	}
	if utils.ArrayContains(allBulkerConfigs, ClickHouseBulkerTypeId+"_cluster_noshards") {
		clickhouseClusterContainerNoShards, err = clickhouse_noshards.NewClickHouseClusterContainerNoShards(context.Background())
		if err != nil {
			panic(err)
		}
		configRegistry[ClickHouseBulkerTypeId+"_cluster_noshards"] = TestConfig{BulkerType: ClickHouseBulkerTypeId, Config: ClickHouseConfig{
			//also test HTTP mode with this config
			Hosts:    clickhouseClusterContainerNoShards.HostsHTTP,
			Protocol: ClickHouseProtocolHTTP,
			Username: "default",
			Database: clickhouseClusterContainerNoShards.Database,
			Cluster:  clickhouseClusterContainerNoShards.Cluster,
			Parameters: map[string]string{
				"enable_json_type": "1",
			},
		}}
	}

	exceptBigquery = utils.ArrayExcluding(allBulkerConfigs, BigqueryBulkerTypeId)

	logging.Infof("Initialized bulker types: %v", allBulkerConfigs)

	//signal.Notify(exitChannel, syscall.Signal(0), os.Interrupt, os.Kill, syscall.SIGTERM)
	//
	//go func() {
	//	sig := <-exitChannel
	//	logging.Infof("Received signal: %s. Shutting down...", sig)
	//	if postgresContainer != nil {
	//		_ = postgresContainer.Close()
	//	}
	//	if mysqlContainer != nil {
	//		_ = mysqlContainer.Close()
	//	}
	//	if clickhouseContainer != nil {
	//		_ = clickhouseContainer.Close()
	//	}
	//	if clickhouseClusterContainer != nil {
	//		_ = clickhouseClusterContainer.Close()
	//	}
	//	if clickhouseClusterContainerNoShards != nil {
	//		_ = clickhouseClusterContainerNoShards.Close()
	//	}
	//}()
}

type TypeCheckingMode int

const (
	//Disabled type checking
	TypeCheckingDisabled TypeCheckingMode = iota
	//DataTypesOnly - check only data types
	TypeCheckingDataTypesOnly
	//SQLTypesOnly - check only sql types
	TypeCheckingSQLTypesOnly
	//TypeCheckingFull - strict type checking
	TypeCheckingFull
)

type bulkerTestConfig struct {
	//name of the test
	name string
	//tableName name of the destination table. Leave empty generate automatically
	tableName string
	namespace string
	//bulker config
	config *bulker.Config
	//for which bulker predefined configurations to run test
	configIds []string
	//continue test run even after Consume() returned error
	ignoreConsumeErrors bool
	//expected state of stream Complete() call
	expectedState *bulker.State
	//schema of the table expected as result of complete test run
	expectedTable ExpectedTable
	//control whether to check types of columns fow expectedTable. For test that run against multiple bulker types is required to leave 'false'
	expectedTableTypeChecking TypeCheckingMode
	//control whether to check character case of table and columns names
	expectedTableCaseChecking bool
	//for configs that runs for multiple modes including bulker.ReplacePartition automatically adds WithPartition to streamOptions and partition id column to expectedTable and expectedRows for that particular mode
	expectPartitionId bool
	//orderBy clause for select query to check expectedTable (default: id asc)
	orderBy []string
	//rows count expected in resulting table. don't use with expectedRows. any type to allow nil value meaning not set
	expectedRowsCount any
	//rows data expected in resulting table
	expectedRows []map[string]any
	//map of expected errors by step name. May be error type or string. String is used for error message partial matching.
	expectedErrors map[string]any
	//map of function to run after each step by step name.
	postStepFunctions map[string]StepFunction
	//don't clean up resulting table before and after test run. See also forceLeaveResultingTables
	leaveResultingTable bool
	//file with objects to consume in ndjson format
	dataFile string
	//bulker stream mode-s to test
	modes []bulker.BulkMode
	//bulker stream options
	streamOptions []bulker.StreamOption
	//batchSize for bigdata test commit stream every batchSize rows
	batchSize int
	//use frozen time for test. See timestamp.FreezeTime for details. Unfreeze time when test finish
	frozenTime time.Time
}

func (c *bulkerTestConfig) getIdAndTableName(mode bulker.BulkMode) (id, tableName, expectedTableName string) {
	tableName = c.tableName
	if tableName == "" {
		tableName = c.name
	}
	tableName = tableName + "_" + strings.ToLower(string(mode))
	expectedTableName = utils.DefaultString(c.expectedTable.Name, tableName)
	id = fmt.Sprintf("%s_%s", c.config.Id, tableName)
	return
}

func TestBasics(t *testing.T) {
	t.Parallel()

	tests := []bulkerTestConfig{
		{
			name:              "added_columns",
			modes:             []bulker.BulkMode{bulker.Batch, bulker.Stream, bulker.ReplaceTable, bulker.ReplacePartition},
			expectPartitionId: true,
			dataFile:          "test_data/columns_added.ndjson",
			expectedTable: ExpectedTable{
				Columns: justColumns("_timestamp", "id", "name", "column1", "column2", "column3"),
			},
			expectedRowsCount: 6,
			expectedRows: []map[string]any{
				{"_timestamp": constantTime, "id": 1, "name": "test", "column1": nil, "column2": nil, "column3": nil},
				{"_timestamp": constantTime, "id": 2, "name": "test2", "column1": "data", "column2": nil, "column3": nil},
				{"_timestamp": constantTime, "id": 3, "name": "test3", "column1": "data", "column2": "data", "column3": nil},
				{"_timestamp": constantTime, "id": 4, "name": "test2", "column1": "data", "column2": nil, "column3": nil},
				{"_timestamp": constantTime, "id": 5, "name": "test", "column1": nil, "column2": nil, "column3": nil},
				{"_timestamp": constantTime, "id": 6, "name": "test4", "column1": "data", "column2": "data", "column3": "data"},
			},
			expectedErrors: map[string]any{"create_stream_bigquery_stream": BigQueryAutocommitUnsupported},
			configIds:      allBulkerConfigs,
		},
		{
			name:              "added_columns_pk",
			modes:             []bulker.BulkMode{bulker.Batch, bulker.Stream, bulker.ReplaceTable, bulker.ReplacePartition},
			expectPartitionId: true,
			dataFile:          "test_data/columns_added.ndjson",
			expectedTable: ExpectedTable{
				PKFields: []string{"id"},
				Columns:  justColumns("_timestamp", "id", "name", "column1", "column2", "column3"),
			},
			expectedRowsCount: 6,
			expectedRows: []map[string]any{
				{"_timestamp": constantTime, "id": 1, "name": "test", "column1": nil, "column2": nil, "column3": nil},
				{"_timestamp": constantTime, "id": 2, "name": "test2", "column1": "data", "column2": nil, "column3": nil},
				{"_timestamp": constantTime, "id": 3, "name": "test3", "column1": "data", "column2": "data", "column3": nil},
				{"_timestamp": constantTime, "id": 4, "name": "test2", "column1": "data", "column2": nil, "column3": nil},
				{"_timestamp": constantTime, "id": 5, "name": "test", "column1": nil, "column2": nil, "column3": nil},
				{"_timestamp": constantTime, "id": 6, "name": "test4", "column1": "data", "column2": "data", "column3": "data"},
			},
			expectedErrors: map[string]any{"create_stream_bigquery_stream": BigQueryAutocommitUnsupported},
			configIds:      allBulkerConfigs,
			streamOptions:  []bulker.StreamOption{bulker.WithPrimaryKey("id"), bulker.WithDeduplicate()},
		},
		{
			name:              "repeated_ids_no_pk",
			modes:             []bulker.BulkMode{bulker.Batch, bulker.Stream, bulker.ReplaceTable, bulker.ReplacePartition},
			expectPartitionId: true,
			dataFile:          "test_data/repeated_ids.ndjson",
			expectedTable: ExpectedTable{
				PKFields: []string{},
				Columns:  justColumns("_timestamp", "id", "name"),
			},
			expectedRows: []map[string]any{
				{"_timestamp": constantTime, "id": 1, "name": "test"},
				{"_timestamp": constantTime, "id": 1, "name": "test7"},
				{"_timestamp": constantTime, "id": 2, "name": "test1"},
				{"_timestamp": constantTime, "id": 3, "name": "test2"},
				{"_timestamp": constantTime, "id": 3, "name": "test3"},
				{"_timestamp": constantTime, "id": 3, "name": "test6"},
				{"_timestamp": constantTime, "id": 4, "name": "test4"},
				{"_timestamp": constantTime, "id": 4, "name": "test5"},
			},
			orderBy:        []string{"id", "name"},
			expectedErrors: map[string]any{"create_stream_bigquery_stream": BigQueryAutocommitUnsupported},
			configIds:      allBulkerConfigs,
		},
		{
			name:              "repeated_ids_pk",
			modes:             []bulker.BulkMode{bulker.Batch, bulker.Stream, bulker.ReplaceTable, bulker.ReplacePartition},
			expectPartitionId: true,
			dataFile:          "test_data/repeated_ids.ndjson",
			expectedTable: ExpectedTable{
				PKFields: []string{"id"},
				Columns:  justColumns("_timestamp", "id", "name"),
			},
			expectedRows: []map[string]any{
				{"_timestamp": constantTime, "id": 1, "name": "test7"},
				{"_timestamp": constantTime, "id": 2, "name": "test1"},
				{"_timestamp": constantTime, "id": 3, "name": "test6"},
				{"_timestamp": constantTime, "id": 4, "name": "test5"},
			},
			expectedErrors: map[string]any{"create_stream_bigquery_stream": BigQueryAutocommitUnsupported},
			configIds:      allBulkerConfigs,
			streamOptions:  []bulker.StreamOption{bulker.WithPrimaryKey("id"), bulker.WithDeduplicate()},
		},
		{
			name:              "multi_pk",
			modes:             []bulker.BulkMode{bulker.Batch, bulker.Stream, bulker.ReplaceTable, bulker.ReplacePartition},
			expectPartitionId: true,
			dataFile:          "test_data/repeated_ids_multi.ndjson",
			expectedTable: ExpectedTable{
				PKFields: []string{"id", "id2"},
				Columns:  justColumns("_timestamp", "id", "id2", "name"),
			},
			expectedRows: []map[string]any{
				{"_timestamp": constantTime, "id": 1, "id2": "a", "name": "test8"},
				{"_timestamp": constantTime, "id": 2, "id2": "b", "name": "test1"},
				{"_timestamp": constantTime, "id": 3, "id2": "c", "name": "test7"},
				{"_timestamp": constantTime, "id": 4, "id2": "d", "name": "test5"},
				{"_timestamp": constantTime, "id": 4, "id2": "dd", "name": "test6"},
			},
			expectedErrors: map[string]any{"create_stream_bigquery_stream": BigQueryAutocommitUnsupported},
			configIds:      allBulkerConfigs,
			orderBy:        []string{"id", "id2"},
			streamOptions:  []bulker.StreamOption{bulker.WithPrimaryKey("id", "id2"), bulker.WithDeduplicate()},
		},
		{
			name:              "multi_pk_ts",
			modes:             []bulker.BulkMode{bulker.Batch, bulker.Stream, bulker.ReplaceTable, bulker.ReplacePartition},
			expectPartitionId: true,
			dataFile:          "test_data/repeated_ids_multi_ts.ndjson",
			expectedTable: ExpectedTable{
				PKFields: []string{"id", "id2"},
				Columns:  justColumns("_timestamp", "id", "id2", "name"),
			},
			expectedRows: []map[string]any{
				{"_timestamp": constantTime, "id": 1, "id2": constantTime, "name": "test8"},
				{"_timestamp": constantTime, "id": 2, "id2": constantTime, "name": "test1"},
				{"_timestamp": constantTime, "id": 3, "id2": constantTime, "name": "test7"},
				{"_timestamp": constantTime, "id": 4, "id2": constantTime, "name": "test5"},
				{"_timestamp": constantTime, "id": 4, "id2": constantTime2, "name": "test6"},
			},
			expectedErrors: map[string]any{"create_stream_bigquery_stream": BigQueryAutocommitUnsupported},
			configIds:      utils.ArrayIntersection(allBulkerConfigs, []string{PostgresBulkerTypeId, ClickHouseBulkerTypeId}),
			orderBy:        []string{"id", "id2"},
			streamOptions:  []bulker.StreamOption{bulker.WithPrimaryKey("id", "id2"), bulker.WithDeduplicate()},
		},
		{
			name:              "timestamp_option",
			modes:             []bulker.BulkMode{bulker.Batch},
			expectPartitionId: true,
			dataFile:          "test_data/simple.ndjson",
			expectedTable: ExpectedTable{
				Columns: justColumns("_timestamp", "id", "name", "extra"),
			},
			expectedRowsCount: 6,
			expectedRows: []map[string]any{
				{"_timestamp": constantTime, "id": 1, "name": "test", "extra": nil},
				{"_timestamp": constantTime, "id": 2, "name": "test", "extra": nil},
				{"_timestamp": constantTime, "id": 3, "name": "test2", "extra": "extra"},
			},
			expectedErrors: map[string]any{"create_stream_bigquery_stream": BigQueryAutocommitUnsupported},
			configIds:      allBulkerConfigs,
			streamOptions:  []bulker.StreamOption{bulker.WithTimestamp("_timestamp")},
		},
		{
			name:              "multiline string",
			modes:             []bulker.BulkMode{bulker.Batch, bulker.Stream, bulker.ReplaceTable, bulker.ReplacePartition},
			expectPartitionId: true,
			dataFile:          "test_data/multiline.ndjson",
			expectedTable: ExpectedTable{
				Columns: justColumns("_timestamp", "id", "name"),
			},
			expectedRowsCount: 6,
			expectedRows: []map[string]any{
				{"_timestamp": constantTime, "id": 1, "name": "\n\ntest"},
				{"_timestamp": constantTime, "id": 2, "name": "test\n\n"},
				{"_timestamp": constantTime, "id": 3, "name": "\ntest2\ntest3\n"},
			},
			expectedErrors: map[string]any{"create_stream_bigquery_stream": BigQueryAutocommitUnsupported},
			configIds:      allBulkerConfigs,
			streamOptions:  []bulker.StreamOption{bulker.WithTimestamp("_timestamp")},
		},
		{
			name:              "schema_option",
			modes:             []bulker.BulkMode{bulker.Batch, bulker.Stream, bulker.ReplaceTable, bulker.ReplacePartition},
			expectPartitionId: true,
			dataFile:          "test_data/schema_option.ndjson",
			expectedTable: ExpectedTable{
				Columns: justColumns("_timestamp", "id", "name", "column1", "column2", "column3"),
			},
			expectedRowsCount: 2,
			expectedRows: []map[string]any{
				{"_timestamp": constantTime, "id": 1, "name": nil, "column1": nil, "column2": nil, "column3": nil},
				{"_timestamp": constantTime, "id": 2, "name": nil, "column1": nil, "column2": nil, "column3": nil},
			},
			expectedErrors: map[string]any{"create_stream_bigquery_stream": BigQueryAutocommitUnsupported},
			configIds:      allBulkerConfigs,
			streamOptions: []bulker.StreamOption{bulker.WithSchema(types2.Schema{
				Name: "schema_option",
				Fields: []types2.SchemaField{
					{Name: "_timestamp", Type: types2.TIMESTAMP},
					{Name: "id", Type: types2.INT64},
					{Name: "name", Type: types2.STRING},
					{Name: "column1", Type: types2.STRING},
					{Name: "column2", Type: types2.STRING},
					{Name: "column3", Type: types2.STRING},
				},
			})},
		},
		{
			name:              "namespace",
			modes:             []bulker.BulkMode{bulker.Batch, bulker.Stream, bulker.ReplaceTable, bulker.ReplacePartition},
			expectPartitionId: true,
			namespace:         "bnsp",
			dataFile:          "test_data/columns_added.ndjson",
			expectedTable: ExpectedTable{
				Columns: justColumns("_timestamp", "id", "name", "column1", "column2", "column3"),
			},
			expectedRowsCount: 6,
			expectedRows: []map[string]any{
				{"_timestamp": constantTime, "id": 1, "name": "test", "column1": nil, "column2": nil, "column3": nil},
				{"_timestamp": constantTime, "id": 2, "name": "test2", "column1": "data", "column2": nil, "column3": nil},
				{"_timestamp": constantTime, "id": 3, "name": "test3", "column1": "data", "column2": "data", "column3": nil},
				{"_timestamp": constantTime, "id": 4, "name": "test2", "column1": "data", "column2": nil, "column3": nil},
				{"_timestamp": constantTime, "id": 5, "name": "test", "column1": nil, "column2": nil, "column3": nil},
				{"_timestamp": constantTime, "id": 6, "name": "test4", "column1": "data", "column2": "data", "column3": "data"},
			},
			streamOptions:  []bulker.StreamOption{bulker.WithNamespace("bnsp")},
			expectedErrors: map[string]any{"create_stream_bigquery_stream": BigQueryAutocommitUnsupported},
			configIds:      allBulkerConfigs,
		},
		{
			name:              "non_utc_timestamp",
			modes:             []bulker.BulkMode{bulker.Batch, bulker.Stream, bulker.ReplaceTable, bulker.ReplacePartition},
			expectPartitionId: true,
			dataFile:          "test_data/non_utc_timestamp.ndjson",
			expectedRows: []map[string]any{
				{"_timestamp": timestamp.MustParseTime(time.RFC3339Nano, "2024-07-16T06:37:15Z"), "id": 1},
				{"_timestamp": timestamp.MustParseTime(time.RFC3339Nano, "2024-12-09T12:15:02Z"), "id": 2},
				{"_timestamp": timestamp.MustParseTime(time.RFC3339Nano, "2024-12-09T16:15:02Z"), "id": 3},
			},
			expectedErrors: map[string]any{"create_stream_bigquery_stream": BigQueryAutocommitUnsupported},
			configIds:      allBulkerConfigs,
		},
		{
			name:              "emoji",
			modes:             []bulker.BulkMode{bulker.Batch},
			expectPartitionId: true,
			dataFile:          "test_data/emoji.ndjson",
			expectedTable: ExpectedTable{
				Columns: justColumns("_timestamp", "id", "name"),
			},
			expectedRowsCount: 3,
			expectedRows: []map[string]any{
				{"_timestamp": constantTime, "id": 1, "name": "test"},
				{"_timestamp": constantTime, "id": 2, "name": "test 😆"},
				{"_timestamp": constantTime, "id": 3, "name": "test2"},
			},
			configIds: allBulkerConfigs,
		},
		{
			name:              "date_type",
			modes:             []bulker.BulkMode{bulker.Batch, bulker.Stream, bulker.ReplaceTable, bulker.ReplacePartition},
			expectPartitionId: true,
			dataFile:          "test_data/date_type.ndjson",
			expectedRowsCount: 3,
			expectedRows: []map[string]any{
				{"_timestamp": constantTime, "id": 1, "name": "test1", "dt": timestamp.CopyTime(constantTime).Truncate(24 * time.Hour)},
				{"_timestamp": constantTime, "id": 2, "name": "test2", "dt": timestamp.CopyTime(constantTime).Truncate(24 * time.Hour)},
				{"_timestamp": constantTime, "id": 3, "name": "test3", "dt": timestamp.CopyTime(constantTime).Truncate(24 * time.Hour)},
			},
			configIds: allBulkerConfigs,
			streamOptions: []bulker.StreamOption{bulker.WithSchema(types2.Schema{
				Name: "d",
				Fields: []types2.SchemaField{
					{Name: "_timestamp", Type: types2.TIMESTAMP},
					{Name: "id", Type: types2.INT64},
					{Name: "dt", Type: types2.TIMESTAMP},
				},
			})},
			expectedErrors: map[string]any{"create_stream_bigquery_stream": BigQueryAutocommitUnsupported},
		},
		{
			name:              "date_mix",
			modes:             []bulker.BulkMode{bulker.Batch, bulker.Stream, bulker.ReplaceTable, bulker.ReplacePartition},
			expectPartitionId: true,
			dataFile:          "test_data/date_mix.ndjson",
			expectedRowsCount: 3,
			expectedRows: []map[string]any{
				{"_timestamp": constantTime, "id": 1, "name": "test1", "dt": constantTime},
				{"_timestamp": constantTime, "id": 2, "name": "test2", "dt": timestamp.CopyTime(constantTime).Truncate(24 * time.Hour)},
				{"_timestamp": constantTime, "id": 3, "name": "test3", "dt": constantTime},
			},
			configIds: allBulkerConfigs,
			streamOptions: []bulker.StreamOption{bulker.WithSchema(types2.Schema{
				Name: "d",
				Fields: []types2.SchemaField{
					{Name: "_timestamp", Type: types2.TIMESTAMP},
					{Name: "id", Type: types2.INT64},
					{Name: "dt", Type: types2.TIMESTAMP},
				},
			})},
			expectedErrors: map[string]any{"create_stream_bigquery_stream": BigQueryAutocommitUnsupported},
		},
		{
			name:              "date_mix_no_schema",
			modes:             []bulker.BulkMode{bulker.Batch, bulker.Stream, bulker.ReplaceTable, bulker.ReplacePartition},
			expectPartitionId: true,
			dataFile:          "test_data/date_mix.ndjson",
			expectedRowsCount: 3,
			expectedRows: []map[string]any{
				{"_timestamp": constantTime, "id": 1, "name": "test1", "dt": constantTime},
				{"_timestamp": constantTime, "id": 2, "name": "test2", "dt": timestamp.CopyTime(constantTime).Truncate(24 * time.Hour)},
				{"_timestamp": constantTime, "id": 3, "name": "test3", "dt": constantTime},
			},
			configIds:      allBulkerConfigs,
			expectedErrors: map[string]any{"create_stream_bigquery_stream": BigQueryAutocommitUnsupported},
		},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			runTestConfig(t, tt, testStream)
		})
	}
}

func runTestConfig(t *testing.T, tt bulkerTestConfig, testFunc func(*testing.T, bulkerTestConfig, bulker.BulkMode)) {
	if tt.config != nil {
		for _, mode := range tt.modes {
			t.Run(string(mode)+"_"+tt.config.Id+"_"+tt.name, func(t *testing.T) {
				testFunc(t, tt, mode)
			})
		}
	} else {
		for _, testConfigId := range tt.configIds {
			newTd := tt
			if !utils.ArrayContains(allBulkerConfigs, testConfigId) {
				continue
			}
			testConfig, ok := configRegistry[testConfigId]
			if !ok {
				t.Fatalf("No config found for %s", testConfigId)
			}
			newTd.config = &bulker.Config{Id: testConfigId, BulkerType: testConfig.BulkerType, DestinationConfig: testConfig.Config, LogLevel: bulker.Verbose}
			for _, mode := range newTd.modes {
				tc := newTd
				mode := mode
				t.Run(string(mode)+"_"+testConfigId+"_"+newTd.name, func(t *testing.T) {
					testFunc(t, tc, mode)
				})
			}
		}
	}
}

func testStream(t *testing.T, testConfig bulkerTestConfig, mode bulker.BulkMode) {
	if !testConfig.frozenTime.IsZero() {
		timestamp.SetFreezeTime(testConfig.frozenTime)
		timestamp.FreezeTime()
		defer timestamp.UnfreezeTime()
	}
	reqr := require.New(t)
	adaptConfig(t, &testConfig, mode)
	PostStep("init", testConfig, mode, reqr, nil)
	blk, err := bulker.CreateBulker(*testConfig.config)
	PostStep("create_bulker", testConfig, mode, reqr, err)
	defer func() {
		err = blk.Close()
		PostStep("bulker_close", testConfig, mode, reqr, err)
	}()
	sqlAdapter, ok := blk.(SQLAdapter)
	reqr.True(ok)
	ctx := context.Background()
	id, tableName, expectedTableName := testConfig.getIdAndTableName(mode)
	namespace := utils.DefaultString(testConfig.namespace, sqlAdapter.DefaultNamespace())
	err = sqlAdapter.InitDatabase(ctx)
	PostStep("init_database", testConfig, mode, reqr, err)
	//clean up in case of previous test failure
	if !testConfig.leaveResultingTable && !forceLeaveResultingTables {
		_ = sqlAdapter.DropTable(ctx, namespace, expectedTableName, true)
		//PostStep("pre_cleanup", testConfig, mode, reqr, err)
	}
	//clean up after test run
	if !testConfig.leaveResultingTable && !forceLeaveResultingTables {
		defer func() {
			_ = sqlAdapter.DropTable(ctx, namespace, expectedTableName, true)
		}()
	}
	stream, err := blk.CreateStream(id, tableName, mode, testConfig.streamOptions...)
	PostStep("create_stream", testConfig, mode, reqr, err)
	if err != nil {
		return
	}
	//Abort stream if error occurred
	defer func() {
		if err != nil {
			_ = stream.Abort(ctx)
			//CheckError("stream_abort", testConfig.config.BulkerType, reqr, testConfig.expectedErrors, err)
		}
	}()

	file, err := os.Open(testConfig.dataFile)
	PostStep("open_file", testConfig, mode, reqr, err)
	defer func() {
		_ = file.Close()
	}()
	scanner := bufio.NewScanner(file)
	i := 0
	streamNum := 0
	scanner.Buffer(make([]byte, 1024*10), 1024*1024*10)
	for scanner.Scan() {
		if i > 0 && testConfig.batchSize > 0 && i%testConfig.batchSize == 0 {
			_, err := stream.Complete(ctx)
			PostStep(fmt.Sprintf("stream_complete_%d", streamNum), testConfig, mode, reqr, err)
			streamNum++
			logging.Infof("%d. batch is completed", i)
			stream, err = blk.CreateStream(id, tableName, mode, testConfig.streamOptions...)
			PostStep(fmt.Sprintf("create_stream_%d", streamNum), testConfig, mode, reqr, err)
			if err != nil {
				return
			}
		}
		_, _, err = stream.ConsumeJSON(ctx, scanner.Bytes())
		PostStep(fmt.Sprintf("consume_object_%d", i), testConfig, mode, reqr, err)
		if err != nil && !testConfig.ignoreConsumeErrors {
			break
		}
		i++
	}
	//Commit stream
	state, err := stream.Complete(ctx)
	PostStep("stream_complete", testConfig, mode, reqr, err)

	if testConfig.expectedState != nil {
		reqr.Equal(*testConfig.expectedState, state)
	}
	if err != nil {
		return
	}
	//PostStep("state_lasterror", testConfig, mode, reqr, state.LastError)
	if testConfig.expectedTable.Columns.Len() > 0 {
		//Check table schema
		table, err := sqlAdapter.GetTableSchema(ctx, namespace, expectedTableName)
		PostStep("get_table", testConfig, mode, reqr, err)
		switch testConfig.expectedTableTypeChecking {
		case TypeCheckingDisabled:
			for el := testConfig.expectedTable.Columns.Front(); el != nil; el = el.Next() {
				el.Value = types2.SQLColumn{Type: "__type_checking_disabled_"}
			}
			for el := table.Columns.Front(); el != nil; el = el.Next() {
				el.Value = types2.SQLColumn{Type: "__type_checking_disabled_"}
			}
		case TypeCheckingDataTypesOnly:
			for el := testConfig.expectedTable.Columns.Front(); el != nil; el = el.Next() {
				el.Value = types2.SQLColumn{DataType: el.Value.DataType}
			}
			for el := table.Columns.Front(); el != nil; el = el.Next() {
				el.Value = types2.SQLColumn{DataType: el.Value.DataType}
			}
		case TypeCheckingSQLTypesOnly:
			for el := testConfig.expectedTable.Columns.Front(); el != nil; el = el.Next() {
				el.Value = types2.SQLColumn{Type: el.Value.Type}
			}
			for el := table.Columns.Front(); el != nil; el = el.Next() {
				el.Value = types2.SQLColumn{Type: el.Value.Type}
			}
		}
		expectedPKFields := jsonorder.NewOrderedSet[string]()
		if len(testConfig.expectedTable.PKFields) > 0 {
			expectedPKFields.PutAll(testConfig.expectedTable.PKFields)
		}

		table.PrimaryKeyName = ""
		expectedTable := &Table{
			Name:           expectedTableName,
			Namespace:      utils.Nvl(testConfig.expectedTable.Namespace, namespace),
			PrimaryKeyName: "",
			PKFields:       expectedPKFields,
			Columns:        testConfig.expectedTable.Columns,
			// don't check this yet
			Partition: table.Partition,
			// don't check this yet
			TimestampColumn: table.TimestampColumn,
		}
		// don't check table name if not explicitly set
		if testConfig.expectedTable.Name == "" {
			table.Name = ""
			expectedTable.Name = ""
		}
		if !testConfig.expectedTableCaseChecking {
			newColumns := NewColumns(0)
			for el := expectedTable.Columns.Front(); el != nil; el = el.Next() {
				newColumns.Set(strings.ToLower(el.Key), el.Value)
			}
			expectedTable.Columns = newColumns
			newColumns = NewColumns(0)
			for el := table.Columns.Front(); el != nil; el = el.Next() {
				newColumns.Set(strings.ToLower(el.Key), el.Value)
			}
			table.Columns = newColumns

			newPKFields := jsonorder.NewOrderedSet[string]()
			expectedTable.PKFields.ForEach(func(k string) {
				newPKFields.Put(strings.ToLower(k))
			})
			expectedTable.PKFields = newPKFields
			newPKFields = jsonorder.NewOrderedSet[string]()
			table.PKFields.ForEach(func(k string) {
				newPKFields.Put(strings.ToLower(k))
			})
			table.PKFields = newPKFields

			table.Name = strings.ToLower(table.Name)
			table.Namespace = strings.ToLower(table.Namespace)
			expectedTable.Name = strings.ToLower(expectedTable.Name)
			expectedTable.Namespace = strings.ToLower(expectedTable.Namespace)
		}
		actualColumns := table.Columns
		expectedColumns := expectedTable.Columns
		table.Columns = nil
		expectedTable.Columns = nil
		reqr.Equal(expectedTable, table)
		reqr.Equal(expectedColumns.ToArray(), actualColumns.ToArray())

	}
	if testConfig.expectedRowsCount != nil || testConfig.expectedRows != nil {
		time.Sleep(1 * time.Second)
		//Check rows count and rows data when provided
		rows, err := sqlAdapter.Select(ctx, namespace, expectedTableName, nil, testConfig.orderBy)
		PostStep("select_result", testConfig, mode, reqr, err)
		if testConfig.expectedRows == nil {
			reqr.Equal(testConfig.expectedRowsCount, len(rows))
		} else {
			reqr.Len(rows, len(testConfig.expectedRows))
			for i, row := range rows {
				exRow := testConfig.expectedRows[i]
				for k, exV := range exRow {
					switch exD := exV.(type) {
					case time.Time:
						reqr.IsType(exV, row[k], "row %d, columns '%s' type mismatch. Expected time.Time", i, k)
						reqr.Equal(exD.Format(time.RFC3339Nano), row[k].(time.Time).Format(time.RFC3339Nano), "row %d, columns '%s' not equals", i, k)
					default:
						reqr.Equal(exV, row[k], "row %d, columns '%s' not equals", i, k)
					}
				}
			}
		}
	}
}

// adaptConfig since we can use a single config for many modes and db types we may need to
// apply changes for specific modes of dbs
func adaptConfig(t *testing.T, testConfig *bulkerTestConfig, mode bulker.BulkMode) {
	if len(testConfig.orderBy) == 0 {
		testConfig.orderBy = []string{"id"}
	}
	switch mode {
	case bulker.ReplacePartition:
		if testConfig.expectPartitionId {
			partitionId := uuid.New()
			newOptions := make([]bulker.StreamOption, len(testConfig.streamOptions))
			copy(newOptions, testConfig.streamOptions)
			newOptions = append(newOptions, bulker.WithPartition(partitionId))
			testConfig.streamOptions = newOptions
			//add partition id column to expectedTable
			if testConfig.expectedTable.Columns.Len() > 0 {
				textColumn, ok := testConfig.expectedTable.Columns.Get("name")
				if !ok {
					textColumn, ok = testConfig.expectedTable.Columns.Get("NAME")
					if !ok {
						t.Fatalf("test config error: expected table must have a 'name' column of string type to guess what type to expect for %s column", PartitonIdKeyword)
					}
				}
				newExpectedTable := ExpectedTable{Name: testConfig.expectedTable.Name, Columns: NewColumns(0), PKFields: slices.Clone(testConfig.expectedTable.PKFields)}
				streamOptions := bulker.StreamOptions{}
				for _, so := range testConfig.streamOptions {
					streamOptions.Add(so)
				}
				schema := bulker.SchemaOption.Get(&streamOptions)
				if !schema.IsEmpty() {
					newExpectedTable.Columns.SetAll(testConfig.expectedTable.Columns)
					newExpectedTable.Columns.Set(PartitonIdKeyword, textColumn)
				} else {
					newExpectedTable.Columns.Set(PartitonIdKeyword, textColumn)
					newExpectedTable.Columns.SetAll(testConfig.expectedTable.Columns)
				}
				testConfig.expectedTable = newExpectedTable
			}
			//add partition id value to all expected rows
			if testConfig.expectedRows != nil {
				newExpectedRows := make([]map[string]any, len(testConfig.expectedRows))
				for i, row := range testConfig.expectedRows {
					newRow := make(map[string]any, len(row)+1)
					utils.MapPutAll(newRow, row)
					newRow[PartitonIdKeyword] = partitionId
					newExpectedRows[i] = newRow
				}
				testConfig.expectedRows = newExpectedRows
			}
		}
	}
}

func PostStep(step string, testConfig bulkerTestConfig, mode bulker.BulkMode, reqr *require.Assertions, err error) {
	bulkerType := testConfig.config.BulkerType
	stepLookupKeys := []string{step + "_" + bulkerType + "_" + strings.ToLower(string(mode)), step + "_" + bulkerType, step}

	//run post step function if any
	stepF := utils.MapNVLKeys(testConfig.postStepFunctions, stepLookupKeys...)
	if stepF != nil {
		err1 := stepF(testConfig, mode)
		if err == nil {
			err = err1
		}
	}

	expectedError := utils.MapNVLKeys(testConfig.expectedErrors, stepLookupKeys...)
	switch target := expectedError.(type) {
	case []string:
		contains := false
		for _, t := range target {
			if strings.Contains(err.Error(), t) {
				contains = true
				break
			}
		}
		if !contains {
			reqr.Fail(fmt.Sprintf("%s", err), "error in step %s doesn't contain one of expected value: %+v", step, target)
		}
	case string:
		reqr.ErrorContainsf(err, target, "error in step %s doesn't contain expected value: %s", step, target)
	case error:
		reqr.ErrorIs(err, target, "error in step %s doesn't match expected error: %s", step, target)
	case nil:
		reqr.NoError(err, "unexpected error in step %s", step)
	default:
		panic(fmt.Sprintf("unexpected type of expected error: %T for step: %s", target, step))
	}
}

// Returns Columns map with no type information
func justColumns(columns ...string) Columns {
	colsMap := NewColumns(0)
	for _, col := range columns {
		colsMap.Set(col, types2.SQLColumn{})
	}
	return colsMap
}
