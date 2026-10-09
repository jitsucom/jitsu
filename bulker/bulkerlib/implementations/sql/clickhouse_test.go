package sql

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/jitsucom/bulker/bulkerlib"
	"github.com/jitsucom/bulker/jitsubase/jsonorder"
)

func TestUnwrapClickHousePrimaryKey(t *testing.T) {
	for input, want := range map[string]string{
		"":                    "",
		"id":                  "id",
		"(id)":                "id",
		"( id )":              "id",
		"id, other":           "id, other",
		"(id, other)":         "id, other",
		"toDate(timestamp)":   "toDate(timestamp)",
		"(toDate(timestamp))": "toDate(timestamp)",
		"(id) + (other)":      "(id) + (other)",
		"(`key(with)paren`)":  "`key(with)paren`",
		"(if(s = ')', 1, 0))": "if(s = ')', 1, 0)",
	} {
		t.Run(input, func(t *testing.T) {
			if got := unwrapClickHousePrimaryKey(input); got != want {
				t.Fatalf("unwrapClickHousePrimaryKey(%q) = %q, want %q", input, got, want)
			}
		})
	}
}

type fakeChCluster struct {
	config      *ClickHouseConfig
	distributed bool
}

func TestClickHouseDatabaseEngineValidation(t *testing.T) {
	for _, tc := range []struct {
		name    string
		engine  ClickHouseDatabaseEngine
		cluster string
		wantErr string
	}{
		{name: "implicit default"},
		{name: "explicit default", engine: DatabaseEngineDefault},
		{name: "replicated", engine: DatabaseEngineReplicated, cluster: "cluster"},
		{name: "unknown engine", engine: "replicatd", cluster: "cluster", wantErr: "databaseEngine"},
		{name: "missing cluster", engine: DatabaseEngineReplicated, wantErr: "cluster"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			config := ClickHouseConfig{Hosts: []string{"localhost:9000"}, Database: "db", Cluster: tc.cluster, DatabaseEngine: tc.engine}
			err := config.Validate()
			if tc.wantErr == "" {
				if err != nil {
					t.Fatal(err)
				}
			} else if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("Validate() = %v, want an error mentioning %q", err, tc.wantErr)
			}
		})
	}
}

func TestReplicatedDatabaseRequiresCluster(t *testing.T) {
	if clickhouseReplicatedDBContainer == nil {
		t.Skip("requires clickhouse_replicated_db")
	}
	config := ClickHouseConfig{
		Hosts:          clickhouseReplicatedDBContainer.Hosts[:1],
		Database:       clickhouseReplicatedDBContainer.Database,
		DatabaseEngine: DatabaseEngineReplicated,
		Username:       "default",
	}
	ch, err := NewClickHouse(bulkerlib.Config{Id: "missing-cluster", DestinationConfig: config})
	if ch != nil {
		defer ch.Close()
	}
	if err == nil || !strings.Contains(err.Error(), "cluster") {
		t.Fatalf("NewClickHouse() = %v, want missing cluster error", err)
	}
}

func TestReplicatedDatabaseRejectsCloud(t *testing.T) {
	_, err := NewClickHouse(bulkerlib.Config{Id: "replicated-cloud", DestinationConfig: ClickHouseConfig{
		Hosts:          []string{"example.clickhouse.cloud:9440"},
		Database:       "default",
		Cluster:        "cluster",
		DatabaseEngine: DatabaseEngineReplicated,
	}})
	if err == nil || !strings.Contains(err.Error(), "ClickHouse Cloud") {
		t.Fatalf("NewClickHouse() = %v, want unsupported Cloud configuration error", err)
	}
}

func (f *fakeChCluster) IsDistributed() bool       { return f.distributed }
func (f *fakeChCluster) Config() *ClickHouseConfig { return f.config }
func (f *fakeChCluster) isReplicatedDatabase() bool {
	return f.config.Cluster != "" && f.config.DatabaseEngine == DatabaseEngineReplicated
}

func TestCreateTableStatement_engineVariants(t *testing.T) {
	cases := []struct {
		name        string
		config      *ClickHouseConfig
		distributed bool
		primaryKey  bool
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
			name:        "cluster, default engine, single shard -> path uses 1/",
			config:      &ClickHouseConfig{Database: "db", Cluster: "c"},
			distributed: false,
			mustContain: []string{"ENGINE = ReplicatedMergeTree('/clickhouse/tables/1/db/", "'{replica}')", "ON CLUSTER `c`"},
			mustNotHave: []string{"ReplicatedMergeTree()"},
		},
		{
			name:        "cluster, default engine, distributed -> path uses {shard}/",
			config:      &ClickHouseConfig{Database: "db", Cluster: "c"},
			distributed: true,
			mustContain: []string{"ENGINE = ReplicatedMergeTree('/clickhouse/tables/{shard}/db/", "ON CLUSTER `c`"},
			mustNotHave: []string{"ReplicatedMergeTree()"},
		},
		{
			name:        "cluster, replicated database -> path-less, no ON CLUSTER",
			config:      &ClickHouseConfig{Database: "db", Cluster: "c", DatabaseEngine: DatabaseEngineReplicated},
			mustContain: []string{"ENGINE = ReplicatedMergeTree()"},
			mustNotHave: []string{"/clickhouse/tables/", "{replica}", "ON CLUSTER"},
		},
		{
			name:        "cluster, replicated database, distributed -> still path-less, no ON CLUSTER",
			config:      &ClickHouseConfig{Database: "db", Cluster: "c", DatabaseEngine: DatabaseEngineReplicated},
			distributed: true,
			mustContain: []string{"ENGINE = ReplicatedMergeTree()"},
			mustNotHave: []string{"/clickhouse/tables/", "{replica}", "ON CLUSTER"},
		},
		{
			name:        "replicated database with primary key -> ReplacingMergeTree",
			config:      &ClickHouseConfig{Database: "db", Cluster: "c", DatabaseEngine: DatabaseEngineReplicated},
			primaryKey:  true,
			mustContain: []string{"ENGINE = ReplicatedReplacingMergeTree()", "PRIMARY KEY (a)", "ORDER BY (a)"},
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
			if tc.primaryKey {
				table.PKFields.Put("a")
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

func TestGetOnClusterClause_replicatedDatabase(t *testing.T) {
	cases := []struct {
		name   string
		config ClickHouseConfig
		want   string
	}{
		{name: "no cluster", config: ClickHouseConfig{}, want: ""},
		{name: "cluster, default engine (implicit)", config: ClickHouseConfig{Cluster: "c"}, want: " ON CLUSTER `c` "},
		{name: "cluster, default engine (explicit)", config: ClickHouseConfig{Cluster: "c", DatabaseEngine: DatabaseEngineDefault}, want: " ON CLUSTER `c` "},
		{name: "cluster, replicated engine", config: ClickHouseConfig{Cluster: "c", DatabaseEngine: DatabaseEngineReplicated}, want: ""},
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

func TestClickHouseUnknownDatabase(t *testing.T) {
	for _, tt := range []struct {
		name string
		err  error
		want bool
	}{
		{"nil", nil, false},
		{"native", &clickhouse.Exception{Code: 81}, true},
		{"wrapped_native", fmt.Errorf("hello: %w", &clickhouse.Exception{Code: 81}), true},
		{"auth", &clickhouse.Exception{Code: 516}, false},
		{"timeout", context.DeadlineExceeded, false},
		{"http", errors.New(`failed to query server hello: sendQuery: [HTTP 404] response body: "Code: 81. DB::Exception: Database missing does not exist. (UNKNOWN_DATABASE)`), true},
		{"http_other", errors.New(`[HTTP 404] response body: "upstream unavailable"`), false},
		{"http_auth", errors.New(`[HTTP 403] response body: "Code: 516. DB::Exception: Authentication failed. (AUTHENTICATION_FAILED)`), false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			if got := isClickHouseUnknownDatabase(tt.err); got != tt.want {
				t.Errorf("got %v, want %v", got, tt.want)
			}
		})
	}
}
