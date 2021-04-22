package adapters

import (
	"github.com/stretchr/testify/require"
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
			"CREATE TABLE \"db1\".\"test_table\"  (a String,b String,c String,d String) ENGINE = ReplacingMergeTree(_timestamp) PARTITION BY (toYYYYMM(_timestamp)) ORDER BY (eventn_ctx_event_id)",
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
			"CREATE TABLE \"db1\".\"test_table\"  (a String,b String,c String,d String) ENGINE = ReplacingMergeTree(_timestamp) PARTITION BY (toYYYYMM(_timestamp)) ORDER BY (id)",
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
			"CREATE TABLE \"db1\".\"test_table\"  (a String,b String,c String,d String) ENGINE = ReplacingMergeTree(_timestamp) PARTITION BY (toYYYYMMDD(_timestamp)) ORDER BY (intHash32(id),_timestamp) PRIMARY KEY (id)",
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
			"CREATE TABLE \"db1\".\"test_table\"  ON CLUSTER \"cluster1\"  (a String,b String,c String,d String) ENGINE = ReplicatedReplacingMergeTree('/clickhouse/tables/{shard}/db1/test_table', '{replica}', _timestamp) PARTITION BY (toYYYYMM(_timestamp)) ORDER BY (eventn_ctx_event_id)",
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
			"CREATE TABLE \"db1\".\"test_table\"  ON CLUSTER \"cluster1\"  (a String,b String,c String,d String) ENGINE = ReplicatedReplacingMergeTree('/clickhouse/tables/{shard}/db1/test_table', '{replica}', _timestamp) PARTITION BY (toYYYYMMDD(_timestamp)) ORDER BY (id,a) PRIMARY KEY (id, b)",
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
			factory, err := NewTableStatementFactory(tt.inputConfig, "eventn_ctx_event_id")
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
