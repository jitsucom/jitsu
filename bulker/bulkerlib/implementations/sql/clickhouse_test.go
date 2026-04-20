package sql

import (
	"strings"
	"testing"

	"github.com/jitsucom/bulker/jitsubase/jsonorder"
)

type fakeChCluster struct {
	config      *ClickHouseConfig
	distributed bool
}

func (f *fakeChCluster) IsDistributed() bool       { return f.distributed }
func (f *fakeChCluster) Config() *ClickHouseConfig { return f.config }
func (f *fakeChCluster) isReplicatedDBMode() bool {
	return f.config.Cluster != "" && f.config.ClusterMode == ClusterModeReplicatedDB
}

func TestCreateTableStatement_engineVariants(t *testing.T) {
	cases := []struct {
		name        string
		config      *ClickHouseConfig
		distributed bool
		mustContain []string
		mustNotHave []string
	}{
		{
			name:        "no cluster -> plain MergeTree",
			config:      &ClickHouseConfig{Database: "db"},
			mustContain: []string{"ENGINE = MergeTree()"},
			mustNotHave: []string{"Replicated", "ON CLUSTER"},
		},
		{
			name:        "cluster, default mode, single shard -> path uses 1/",
			config:      &ClickHouseConfig{Database: "db", Cluster: "c"},
			distributed: false,
			mustContain: []string{"ENGINE = ReplicatedMergeTree('/clickhouse/tables/1/db/", "'{replica}')", "ON CLUSTER `c`"},
			mustNotHave: []string{"ReplicatedMergeTree()"},
		},
		{
			name:        "cluster, default mode, distributed -> path uses {shard}/",
			config:      &ClickHouseConfig{Database: "db", Cluster: "c"},
			distributed: true,
			mustContain: []string{"ENGINE = ReplicatedMergeTree('/clickhouse/tables/{shard}/db/", "ON CLUSTER `c`"},
			mustNotHave: []string{"ReplicatedMergeTree()"},
		},
		{
			name:        "cluster, replicated_db mode -> path-less, no ON CLUSTER",
			config:      &ClickHouseConfig{Database: "db", Cluster: "c", ClusterMode: ClusterModeReplicatedDB},
			mustContain: []string{"ENGINE = ReplicatedMergeTree()"},
			mustNotHave: []string{"/clickhouse/tables/", "{replica}", "ON CLUSTER"},
		},
		{
			name:        "cluster, replicated_db mode, distributed -> still path-less, no ON CLUSTER",
			config:      &ClickHouseConfig{Database: "db", Cluster: "c", ClusterMode: ClusterModeReplicatedDB},
			distributed: true,
			mustContain: []string{"ENGINE = ReplicatedMergeTree()"},
			mustNotHave: []string{"/clickhouse/tables/", "{replica}", "ON CLUSTER"},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cluster := &fakeChCluster{config: tc.config, distributed: tc.distributed}
			tsf := NewTableStatementFactory(cluster)
			table := &Table{
				Name:     "events",
				Columns:  NewColumns(0),
				PKFields: jsonorder.NewOrderedSet[string](),
			}
			stmt := tsf.CreateTableStatement("`db`.", "`events`", "events", "`a` String", table)
			for _, want := range tc.mustContain {
				if !strings.Contains(stmt, want) {
					t.Fatalf("statement missing %q\nactual: %s", want, stmt)
				}
			}
			for _, unwanted := range tc.mustNotHave {
				if strings.Contains(stmt, unwanted) {
					t.Fatalf("statement unexpectedly contains %q\nactual: %s", unwanted, stmt)
				}
			}
		})
	}
}

func TestGetOnClusterClause_replicatedDBMode(t *testing.T) {
	cases := []struct {
		name   string
		config ClickHouseConfig
		want   string
	}{
		{name: "no cluster", config: ClickHouseConfig{}, want: ""},
		{name: "cluster, default mode", config: ClickHouseConfig{Cluster: "c"}, want: " ON CLUSTER `c` "},
		{name: "cluster, on_cluster mode", config: ClickHouseConfig{Cluster: "c", ClusterMode: ClusterModeOnCluster}, want: " ON CLUSTER `c` "},
		{name: "cluster, replicated_db mode", config: ClickHouseConfig{Cluster: "c", ClusterMode: ClusterModeReplicatedDB}, want: ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ch := &ClickHouse{SQLAdapterBase: &SQLAdapterBase[ClickHouseConfig]{config: &tc.config}}
			got := ch.getOnClusterClause()
			if got != tc.want {
				t.Fatalf("getOnClusterClause = %q, want %q", got, tc.want)
			}
		})
	}
}
