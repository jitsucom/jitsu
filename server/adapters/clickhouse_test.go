package adapters

import (
	"context"
	"fmt"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/test"
	"github.com/jitsucom/jitsu/server/typing"
	uuid "github.com/satori/go.uuid"
	"github.com/stretchr/testify/require"
	"gotest.tools/assert"
	"math/rand"
	"strings"
	"testing"
)

func TestTableStatementFactory(t *testing.T) {
	tests := []struct {
		name                   string
		inputConfig            *ClickHouseConfig
		expectedTableStatement string
	}{
		{
			"Nil config",
			nil,
			"",
		},
		{
			"Input config without cluster and overrides",
			&ClickHouseConfig{
				Dsns:     []string{},
				Database: "db1",
				Cluster:  "",
			},
			"CREATE TABLE \"db1\".\"test_table\"  (a String,b String,c String,d String) ENGINE = ReplacingMergeTree() PARTITION BY (toYYYYMM(_timestamp)) ORDER BY (eventn_ctx_event_id)",
		},
		{
			"Input config without cluster with order by",
			&ClickHouseConfig{
				Dsns:     []string{},
				Database: "db1",
				Engine: &EngineConfig{
					OrderFields: []FieldConfig{{Field: "id"}},
					PrimaryKeys: nil,
				},
				Cluster: "",
			},
			"CREATE TABLE \"db1\".\"test_table\"  (a String,b String,c String,d String) ENGINE = ReplacingMergeTree() PARTITION BY (toYYYYMM(_timestamp)) ORDER BY (id)",
		},
		{
			"Input config without cluster with overrides",
			&ClickHouseConfig{
				Dsns:     []string{},
				Database: "db1",
				Cluster:  "",
				Engine: &EngineConfig{
					PartitionFields: []FieldConfig{
						{Function: "toYYYYMMDD", Field: "_timestamp"},
					},
					OrderFields: []FieldConfig{
						{Function: "intHash32", Field: "id"},
						{Field: "_timestamp"},
					},
					PrimaryKeys: []string{"id"},
				},
			},
			"CREATE TABLE \"db1\".\"test_table\"  (a String,b String,c String,d String) ENGINE = ReplacingMergeTree() PARTITION BY (toYYYYMMDD(_timestamp)) ORDER BY (intHash32(id),_timestamp) PRIMARY KEY (id)",
		},
		{
			"Input config without cluster without overrides with raw statement",
			&ClickHouseConfig{
				Dsns:     []string{},
				Database: "db1",
				Cluster:  "",
				Engine: &EngineConfig{
					RawStatement: "ENGINE = ReplacingMergeTree(d) ORDER BY (e)",
				},
			},
			"CREATE TABLE \"db1\".\"test_table\"  (a String,b String,c String,d String) ENGINE = ReplacingMergeTree(d) ORDER BY (e)",
		},
		{
			"Input config without cluster with overrides with raw statement",
			&ClickHouseConfig{
				Dsns:     []string{},
				Database: "db1",
				Cluster:  "",
				Engine: &EngineConfig{
					RawStatement: "ENGINE = ReplacingMergeTree(d) ORDER BY (e)",
					PartitionFields: []FieldConfig{
						{Function: "toYYYYMMDD", Field: "_timestamp"},
					},
					OrderFields: []FieldConfig{
						{Field: "id"},
					},
					PrimaryKeys: []string{"id"},
				},
			},
			"CREATE TABLE \"db1\".\"test_table\"  (a String,b String,c String,d String) ENGINE = ReplacingMergeTree(d) ORDER BY (e)",
		},
		{
			"Input config with cluster without overrides",
			&ClickHouseConfig{
				Dsns:     []string{},
				Database: "db1",
				Cluster:  "cluster1",
			},
			"CREATE TABLE \"db1\".\"test_table\"  ON CLUSTER \"cluster1\"  (a String,b String,c String,d String) ENGINE = ReplicatedReplacingMergeTree('/clickhouse/tables/{shard}/db1/test_table', '{replica}') PARTITION BY (toYYYYMM(_timestamp)) ORDER BY (eventn_ctx_event_id)",
		},
		{
			"Input config with cluster with overrides",
			&ClickHouseConfig{
				Dsns:     []string{},
				Database: "db1",
				Cluster:  "cluster1",
				Engine: &EngineConfig{
					PartitionFields: []FieldConfig{
						{Function: "toYYYYMMDD", Field: "_timestamp"},
					},
					OrderFields: []FieldConfig{
						{Field: "id"}, {Field: "a"},
					},
					PrimaryKeys: []string{"id", "b"},
				},
			},
			"CREATE TABLE \"db1\".\"test_table\"  ON CLUSTER \"cluster1\"  (a String,b String,c String,d String) ENGINE = ReplicatedReplacingMergeTree('/clickhouse/tables/{shard}/db1/test_table', '{replica}') PARTITION BY (toYYYYMMDD(_timestamp)) ORDER BY (id,a) PRIMARY KEY (id, b)",
		},
		{
			"Input config with cluster without overrides with raw statement",
			&ClickHouseConfig{
				Dsns:     []string{},
				Database: "db1",
				Cluster:  "cluster1",
				Engine: &EngineConfig{
					RawStatement: "ENGINE = ReplacingMergeTree(d) ORDER BY (e) PRIMARY KEY (a)",
				},
			},
			"CREATE TABLE \"db1\".\"test_table\"  ON CLUSTER \"cluster1\"  (a String,b String,c String,d String) ENGINE = ReplacingMergeTree(d) ORDER BY (e) PRIMARY KEY (a)",
		},
		{
			"Input config with cluster with overrides with raw statement",
			&ClickHouseConfig{
				Dsns:     []string{},
				Database: "db1",
				Cluster:  "cluster1",
				Engine: &EngineConfig{
					RawStatement: "ENGINE = ReplacingMergeTree(d) ORDER BY (e) PRIMARY KEY (a)",
					PartitionFields: []FieldConfig{
						{Function: "toYYYYMMDD", Field: "_timestamp"},
					},
					OrderFields: []FieldConfig{
						{Field: "id"}, {Field: "a"},
					},
					PrimaryKeys: []string{"id", "b"},
				},
			},
			"CREATE TABLE \"db1\".\"test_table\"  ON CLUSTER \"cluster1\"  (a String,b String,c String,d String) ENGINE = ReplacingMergeTree(d) ORDER BY (e) PRIMARY KEY (a)",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			factory, err := NewTableStatementFactory(tt.inputConfig)
			if tt.expectedTableStatement == "" {
				require.Error(t, err, "Clickhouse config can't be nil")
				return
			}
			require.NotNil(t, factory)

			actual := factory.CreateTableStatement("test_table", "a String,b String,c String,d String")
			require.Equal(t, tt.expectedTableStatement, strings.TrimSpace(actual), "Statements aren't equal")
		})
	}
}

func TestClickhouseTruncateExistingTable(t *testing.T) {
	recordsCount := len(timestamps)
	table := &Table{
		Name: "test_truncate_existing_table",
		Columns: Columns{
			"eventn_ctx_event_id": typing.SQLColumn{Type: SchemaToClickhouse[typing.STRING]},
			"field2":              typing.SQLColumn{Type: SchemaToClickhouse[typing.STRING]},
			"field3":              typing.SQLColumn{Type: SchemaToClickhouse[typing.INT64]},
			"user":                typing.SQLColumn{Type: SchemaToClickhouse[typing.STRING]},
			"_timestamp":          typing.SQLColumn{Type: SchemaToClickhouse[typing.TIMESTAMP]},
		},
	}
	container, clickHouse := setupClickHouseDatabase(t, table)
	defer container.Close()
	err := clickHouse.insert(table, createObjectsForClickHouse(recordsCount)...)
	require.NoError(t, err, fmt.Sprintf("Failed to bulk insert %d objects", recordsCount))
	rows, err := container.CountRows(table.Name)
	require.NoError(t, err, "Failed to count objects at "+table.Name)
	assert.Equal(t, rows, recordsCount)
	err = clickHouse.Truncate(table.Name)
	require.NoError(t, err, "Failed to truncate table")
	rows, err = container.CountRows(table.Name)
	require.NoError(t, err, "Failed to count objects at "+table.Name)
	assert.Equal(t, rows, 0)
}

func TestClickhouseTruncateNonexistentTable(t *testing.T) {
	tableName := uuid.NewV4().String()
	container, clickHouse := setupClickHouseDatabase(t, nil)
	defer container.Close()
	err := clickHouse.Truncate(tableName)
	require.NoError(t, err, "Failed to truncate nonexistent table "+tableName)
}

func setupClickHouseDatabase(t *testing.T, table *Table) (*test.ClickHouseContainer, *ClickHouse) {
	ctx := context.Background()
	container, err := test.NewClickhouseContainer(ctx)
	if err != nil {
		t.Fatalf("failed to initialize container: %v", err)
	}
	tsf, err := NewTableStatementFactory(&ClickHouseConfig{
		Dsns:     container.Dsns,
		Database: container.Database,
		Cluster:  "",
	})
	if err != nil {
		t.Fatalf("failed to initialize table statement factory: %v", err)
	}
	adapter, err := NewClickHouse(ctx, container.Dsns[0], container.Database, "", nil, tsf, map[string]bool{},
		&logging.QueryLogger{}, typing.SQLTypes{})
	if err != nil {
		t.Fatalf("Failed to create ClickHouse adapter: %v", err)
	}
	if table != nil {
		err = adapter.CreateTable(table)
		require.NoError(t, err, "Failed to create table")
	}
	return container, adapter
}

func createObjectsForClickHouse(num int) []map[string]interface{} {
	var objects []map[string]interface{}
	for i := 0; i < num; i++ {
		object := make(map[string]interface{})
		object["field1"] = fmt.Sprintf("100000-%d", i)
		object["field2"] = fmt.Sprint(rand.Int())
		object["field3"] = rand.Int()
		object["user"] = fmt.Sprint(rand.Int())
		object["_interval_start"] = timestamps[i%len(timestamps)]
		object["eventn_ctx_event_id"] = uuid.NewV4()
		objects = append(objects, object)
	}
	return objects
}
