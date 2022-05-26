package integration_tests

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/config"
	"github.com/jitsucom/jitsu/server/coordination"
	"github.com/jitsucom/jitsu/server/enrichment"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/schema"
	"github.com/jitsucom/jitsu/server/storages"
	"github.com/jitsucom/jitsu/server/telemetry"
	"github.com/jitsucom/jitsu/server/test"
	"github.com/jitsucom/jitsu/server/typing"
	"github.com/jitsucom/jitsu/server/uuid"
	sf "github.com/snowflakedb/gosnowflake"
	"github.com/spf13/viper"
	"github.com/stretchr/testify/require"
	"math/rand"
	"strings"
	"testing"
	"time"
)

const (
	tableNameWithoutPKPrefix    = "local_tests_"
	tableNameWithPKPrefix       = "local_tests_with_pk_"
	streamTableNameWithPKPrefix = "local_tests_stream_with_pk_"
)

var ErrNotConfigured = errors.New("config isn't configured")

//InsertTestSuite is a test suit and keeps all opened resources
type InsertTestSuite struct {
	container  test.Container
	adapter    adapters.SQLAdapter
	datasource *sql.DB
	Schema     string
}

func (its *InsertTestSuite) CountRows(tableName string) (int, error) {
	if its.container != nil {
		return its.container.CountRows(tableName)
	}

	//count rows for destinations configured via ENV
	rows, err := its.datasource.Query(fmt.Sprintf("SELECT count(*) from %s", tableName))
	if err != nil {
		errMessage := err.Error()
		if strings.HasPrefix(errMessage, "pq: relation") && strings.HasSuffix(errMessage, "does not exist") {
			return 0, err
		}

		return -1, err
	}
	defer rows.Close()
	rows.Next()
	var count int
	err = rows.Scan(&count)
	return count, err
}

func (its *InsertTestSuite) Close() {
	if its.container != nil {
		its.container.Close()
	}

	if its.adapter != nil {
		its.adapter.Close()
	}

	if its.datasource != nil {
		its.datasource.Close()
	}
}

//TestDestinationAdapterInsert runs docker test container for MySQL, Postgres, Clickhouse
//(or gets connection parameters for setting up Redshift and Snowflake adapters)
//Generates test objects and do:
//1. execute batch insert with table without PK
//2. execute stream insert with table without PK
//3. execute batch insert with table with PK (make sure that there aren't any duplicates)
//4. execute stream insert with table with PK (make sure that there aren't any duplicates)
func TestDestinationAdapterInsert(t *testing.T) {
	telemetry.InitTest()
	viper.Set("server.log.path", "")
	viper.Set("server.log.level", "debug")
	viper.Set("sql_debug_log.ddl.enabled", false)

	err := appconfig.Init(false, "")
	require.NoError(t, err)

	enrichment.InitDefault("", "", "", "", "")

	tests := []struct {
		name                      string
		destinationType           string
		types                     map[typing.DataType]string
		generateBatchObjects      int
		generateStreamObjects     int
		generateBatchPKObjects    int
		generateBatchPKUniqueIDs  int
		generateStreamPKObjects   int
		generateStreamPKUniqueIDs int
		expectedStreamPKRows      int
	}{
		{
			"Insert into MySQL test",
			storages.MySQLType,
			adapters.SchemaToMySQL,
			adapters.MySQLValuesLimit + rand.Intn(1000) + 1, //make sure that there will be 2 iterations on insert
			rand.Intn(10),
			adapters.MySQLValuesLimit + rand.Intn(1000) + 1, //make sure that there will be 2 iterations on insert
			rand.Intn(30_000) + 1,
			10,
			5,
			5, //deduplication on stream insert
		},
		{
			"Insert into Postgres test",
			storages.PostgresType,
			adapters.SchemaToPostgres,
			adapters.PostgresValuesLimit + rand.Intn(1000) + 1, //make sure that there will be 2 iterations on insert
			rand.Intn(10),
			adapters.PostgresValuesLimit + rand.Intn(1000) + 1, //make sure that there will be 2 iterations on insert
			rand.Intn(30_000) + 1,
			10,
			5,
			5, //deduplication on stream insert
		},
		{
			"Insert into Redshift test",
			storages.RedshiftType,
			adapters.SchemaToRedshift,
			adapters.RedshiftValuesLimit + rand.Intn(1000) + 1, //make sure that there will be 2 iterations on insert
			rand.Intn(10),
			adapters.RedshiftValuesLimit + rand.Intn(1000) + 1, //make sure that there will be 2 iterations on insert
			rand.Intn(30_000) + 1,
			10,
			5,
			10, //no deduplication on stream insert
		},
		{
			"Insert into Clickhouse test",
			storages.ClickHouseType,
			adapters.SchemaToClickhouse,
			rand.Intn(50_000) + 1,
			rand.Intn(10),
			rand.Intn(50_000) + 1,
			rand.Intn(30_000) + 1,
			10,
			5,
			5, //deduplication on stream insert
		},
		{
			"Insert into Snowflake test",
			storages.SnowflakeType,
			adapters.SchemaToSnowflake,
			adapters.PostgresValuesLimit + rand.Intn(1000) + 1, //make sure that there will be 2 iterations on insert
			rand.Intn(10),
			adapters.PostgresValuesLimit + rand.Intn(1000) + 1, //make sure that there will be 2 iterations on insert
			rand.Intn(30_000) + 1,
			10,
			5,
			10, //no deduplication on stream insert
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			testsuit, err := initializeTestSuite(t, tt.destinationType)
			if err == ErrNotConfigured {
				return
			}

			require.NoError(t, err, "failed to initialize test suite")

			defer testsuit.Close()

			tableHelperWithoutPK := storages.NewTableHelper(testsuit.Schema, testsuit.adapter, coordination.NewInMemoryService(""), map[string]bool{}, tt.types, 0, tt.destinationType)

			processor, err := schema.NewProcessor("test", &config.DestinationConfig{}, true, "replace_me", schema.DummyMapper{}, nil, schema.NewFlattener(), schema.NewTypeResolver(), appconfig.Instance.GlobalUniqueIDField, 0, "new", false)
			require.NoError(t, err)
			require.NotNil(t, processor)
			err = processor.InitJavaScriptTemplates()
			require.NoError(t, err)

			generatedTableNameWithPK := tableNameWithPKPrefix + uuid.NewLettersNumbers()[:5]
			generatedTableNameWithoutPK := tableNameWithoutPKPrefix + uuid.NewLettersNumbers()[:5]
			generatedStreamTableNameWithPK := streamTableNameWithPKPrefix + uuid.NewLettersNumbers()[:5]
			//cleanup
			defer func() {
				testsuit.adapter.DropTable(&adapters.Table{Name: generatedTableNameWithPK})
				testsuit.adapter.DropTable(&adapters.Table{Name: generatedTableNameWithoutPK})
				testsuit.adapter.DropTable(&adapters.Table{Name: generatedStreamTableNameWithPK})
			}()

			// -- test batch without PK --
			data, err := test.NewRandomGenerator(appconfig.Instance.GlobalUniqueIDField).GenerateData(20, tt.generateBatchObjects+tt.generateStreamObjects)
			require.NoError(t, err)
			insertBatch(t, processor, testsuit.adapter, tableHelperWithoutPK, generatedTableNameWithoutPK, data[:tt.generateBatchObjects], tt.destinationType)
			rowsUnique, err := testsuit.CountRows(generatedTableNameWithoutPK)
			require.NoError(t, err)
			require.Equal(t, tt.generateBatchObjects, rowsUnique)

			//-- test single without PK --
			insertStream(t, processor, testsuit.adapter, tableHelperWithoutPK, generatedTableNameWithoutPK, data[tt.generateBatchObjects:], tt.destinationType)
			rowsUnique, err = testsuit.CountRows(generatedTableNameWithoutPK)
			require.NoError(t, err)
			require.Equal(t, tt.generateBatchObjects+tt.generateStreamObjects, rowsUnique)

			tableHelperWitPK := storages.NewTableHelper(testsuit.Schema, testsuit.adapter, coordination.NewInMemoryService(""),
				map[string]bool{appconfig.Instance.GlobalUniqueIDField.GetFlatFieldName(): true}, tt.types, 0, tt.destinationType)

			// -- test batch with PK --
			data, err = test.NewRandomGenerator(appconfig.Instance.GlobalUniqueIDField).GenerateDataWithUniqueIDs(10, tt.generateBatchPKObjects, tt.generateBatchPKUniqueIDs)
			require.NoError(t, err)
			insertBatch(t, processor, testsuit.adapter, tableHelperWitPK, generatedTableNameWithPK, data, tt.destinationType)
			rowsUnique, err = testsuit.CountRows(generatedTableNameWithPK)

			require.Equal(t, tt.generateBatchPKUniqueIDs, rowsUnique)

			//-- test single with PK --
			data, err = test.NewRandomGenerator(appconfig.Instance.GlobalUniqueIDField).GenerateDataWithUniqueIDs(10, tt.generateStreamPKObjects, tt.generateStreamPKUniqueIDs)
			insertStream(t, processor, testsuit.adapter, tableHelperWitPK, generatedStreamTableNameWithPK, data, tt.destinationType)
			rowsUnique, err = testsuit.CountRows(generatedStreamTableNameWithPK)
			require.NoError(t, err)
			require.Equal(t, tt.expectedStreamPKRows, rowsUnique)
		})
	}
}

//insertBatch generic function for writing data with adapter
func insertBatch(t *testing.T, processor *schema.Processor, adapter adapters.SQLAdapter,
	tableHelper *storages.TableHelper, tableName string, data []map[string]interface{}, destinationType string) {
	logging.Debugf("start inserting batch %d object into %s. It can take some time", len(data), destinationType)
	start := time.Now()

	firstBatch, _, fe, se, err := processor.ProcessEvents("testfile", data, map[string]bool{}, false)
	require.NoError(t, err)
	require.True(t, fe.IsEmpty())
	require.True(t, se.IsEmpty())
	require.Equal(t, 1, len(firstBatch))

	for _, batch := range firstBatch {
		batch.BatchHeader.TableName = tableName
		dataSchema := tableHelper.MapTableSchema(batch.BatchHeader)
		table, err := tableHelper.EnsureTableWithCaching("test", dataSchema)
		require.NoError(t, err, "failed to ensure table with random data: %v", err)

		err = adapter.Insert(adapters.NewBatchInsertContext(table, batch.GetPayload(), nil))
		require.NoError(t, err)
	}
	operationTime := time.Since(start)
	logging.Debugf("[debug] %s inserted batch of %d data rows in [%.2f] seconds (%.2f minutes)", destinationType, len(data), operationTime.Seconds(), operationTime.Minutes())
}

//insertStream generic function for writing data with adapter
func insertStream(t *testing.T, processor *schema.Processor, adapter adapters.SQLAdapter,
	tableHelper *storages.TableHelper, tableName string, data []map[string]interface{}, destinationType string) {
	logging.Debugf("start inserting stream %d object into %s. It can take some time", len(data), destinationType)
	start := time.Now()

	for _, obj := range data {
		envelops, err := processor.ProcessEvent(obj, false)
		require.NoError(t, err)
		for _, e := range envelops {
			e.Header.TableName = tableName
			dataSchema := tableHelper.MapTableSchema(e.Header)
			table, err := tableHelper.EnsureTableWithCaching("test", dataSchema)
			require.NoError(t, err, "failed to ensure table with random data: %v", err)

			err = adapter.Insert(adapters.NewSingleInsertContext(&adapters.EventContext{
				CacheDisabled:  true,
				DestinationID:  "test",
				EventID:        appconfig.Instance.GlobalUniqueIDField.Extract(obj),
				TokenID:        "123",
				Src:            "src",
				ProcessedEvent: e.Event,
				Table:          table,
			}))
			require.NoError(t, err, "failed to insert %+v", err)
		}
	}
	operationTime := time.Since(start)
	logging.Debugf("[debug] %s inserted stream of %d data rows in [%.2f] seconds (%.2f minutes)", destinationType, len(data), operationTime.Seconds(), operationTime.Minutes())
}

func initializeTestSuite(t *testing.T, destinationType string) (*InsertTestSuite, error) {
	ctx := context.Background()
	switch destinationType {
	case storages.MySQLType:
		container, err := test.NewMySQLContainer(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to initialize container: %v", err)
		}

		dsConfig := &adapters.DataSourceConfig{
			Host:       container.Host,
			Port:       container.Port,
			Db:         container.Database,
			Username:   container.Username,
			Password:   container.Password,
			Parameters: map[string]string{"tls": "false"},
		}
		mySQLAdapter, err := adapters.NewMySQL(ctx, dsConfig, logging.NewQueryLogger("test", nil, nil), typing.SQLTypes{})
		if err != nil {
			return nil, fmt.Errorf("failed to create adapter: %v", err)
		}

		return &InsertTestSuite{
			container:  container,
			adapter:    mySQLAdapter,
			datasource: nil,
			Schema:     container.Database,
		}, nil

	case storages.PostgresType:
		container, err := test.NewPostgresContainer(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to initialize container: %v", err)
		}

		dsConfig := &adapters.DataSourceConfig{
			Host:       container.Host,
			Port:       container.Port,
			Schema:     container.Schema,
			Username:   container.Username,
			Password:   container.Password,
			Db:         container.Database,
			Parameters: map[string]string{"sslmode": "disable"},
		}

		postgresAdapter, err := adapters.NewPostgres(ctx, dsConfig, logging.NewQueryLogger("test", nil, nil), typing.SQLTypes{})
		if err != nil {
			return nil, fmt.Errorf("failed to create adapter: %v", err)
		}

		return &InsertTestSuite{
			container:  container,
			adapter:    postgresAdapter,
			datasource: nil,
			Schema:     container.Schema,
		}, nil

	case storages.RedshiftType:
		redshiftConfig, ok := adapters.ReadRedshiftConfig(t)
		if !ok {
			return nil, ErrNotConfigured
		}

		redshift, err := adapters.NewAwsRedshift(context.Background(), redshiftConfig, nil, &logging.QueryLogger{}, typing.SQLTypes{})
		if err != nil {
			return nil, fmt.Errorf("failed to create adapter: %v", err)
		}

		//initialize datasource for asserts
		connectionString := fmt.Sprintf("host=%s port=%d dbname=%s user=%s password=%s ",
			redshiftConfig.Host, redshiftConfig.Port, redshiftConfig.Db, redshiftConfig.Username, redshiftConfig.Password)
		//concat provided connection parameters
		for k, v := range redshiftConfig.Parameters {
			connectionString += k + "=" + v + " "
		}

		dataSource, err := sql.Open("postgres", connectionString)
		if err != nil {
			redshift.Close()
			return nil, fmt.Errorf("error creating datasource for asserts: %v", err)
		}

		if err = dataSource.Ping(); err != nil {
			dataSource.Close()
			redshift.Close()
			return nil, fmt.Errorf("error ping datasource for asserts: %v", err)
		}

		return &InsertTestSuite{
			container:  nil,
			adapter:    redshift,
			datasource: dataSource,
			Schema:     redshiftConfig.Schema,
		}, nil

	case storages.ClickHouseType:
		container, err := test.NewClickhouseContainer(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to initialize container: %v", err)
		}

		tsf, err := adapters.NewTableStatementFactory(&adapters.ClickHouseConfig{
			Dsns:     container.Dsns,
			Database: container.Database,
			Cluster:  "",
		})
		if err != nil {
			return nil, fmt.Errorf("failed to initialize table statement factory: %v", err)
		}

		adapter, err := adapters.NewClickHouse(ctx, container.Dsns[0], container.Database, "", nil, tsf, map[string]bool{},
			&logging.QueryLogger{}, typing.SQLTypes{})
		if err != nil {
			return nil, fmt.Errorf("failed to create adapter: %v", err)
		}

		return &InsertTestSuite{
			container:  container,
			adapter:    adapter,
			datasource: nil,
			Schema:     container.Database,
		}, nil

	case storages.SnowflakeType:
		snowflakeConfig, ok := adapters.ReadSFConfig(t)
		if !ok {
			return nil, ErrNotConfigured
		}

		snowflakeAdapter, err := adapters.NewSnowflake(context.Background(), snowflakeConfig, nil, &logging.QueryLogger{}, typing.SQLTypes{})
		if err != nil {
			return nil, fmt.Errorf("failed to create adapter: %v", err)
		}

		//initialize datasource for asserts
		cfg := &sf.Config{
			Account:   snowflakeConfig.Account,
			User:      snowflakeConfig.Username,
			Password:  snowflakeConfig.Password,
			Port:      snowflakeConfig.Port,
			Schema:    snowflakeConfig.Schema,
			Database:  snowflakeConfig.Db,
			Warehouse: snowflakeConfig.Warehouse,
			Params:    snowflakeConfig.Parameters,
		}
		connectionString, err := sf.DSN(cfg)
		if err != nil {
			return nil, err
		}

		dataSource, err := sql.Open("snowflake", connectionString)
		if err != nil {
			snowflakeAdapter.Close()
			return nil, err
		}

		if err := dataSource.Ping(); err != nil {
			snowflakeAdapter.Close()
			dataSource.Close()
			return nil, err
		}

		return &InsertTestSuite{
			container:  nil,
			adapter:    snowflakeAdapter,
			datasource: dataSource,
			Schema:     snowflakeConfig.Schema,
		}, nil
	default:
		return nil, errors.New("unknown destination type for creating test suite")
	}
}
