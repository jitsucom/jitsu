package sql

import (
	"context"
	"database/sql"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	bulker "github.com/jitsucom/bulker/bulkerlib"
	"github.com/jitsucom/bulker/bulkerlib/implementations/sql/testcontainers/clickhouse_replicated_db"
	"github.com/jitsucom/bulker/jitsubase/uuid"
	"github.com/stretchr/testify/require"
)

func TestReplicatedDatabaseConcurrentBootstrap(t *testing.T) {
	ran := false
	for _, id := range []string{"clickhouse_replicated_db", "clickhouse_replicated_db_sharded"} {
		registered, ok := configRegistry[id]
		if !ok {
			continue
		}
		ran = true
		t.Run(id, func(t *testing.T) {
			config := registered.Config.(ClickHouseConfig)
			config.Database = "bootstrap_concurrent_" + uuid.NewLettersNumbers()
			start := make(chan struct{})
			errors := make(chan error, len(config.Hosts))
			var wg sync.WaitGroup
			for _, host := range config.Hosts {
				wg.Add(1)
				go func() {
					defer wg.Done()
					<-start
					local := config
					local.Hosts = []string{host}
					instance, err := NewClickHouse(bulker.Config{Id: "concurrent-bootstrap", DestinationConfig: local})
					if instance != nil {
						defer instance.Close()
					}
					errors <- err
				}()
			}
			close(start)
			wg.Wait()
			close(errors)
			for err := range errors {
				require.NoError(t, err)
			}
			db, err := sql.Open("clickhouse", clickhouseDriverConnectionString(&config))
			require.NoError(t, err)
			defer db.Close()
			ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
			defer cancel()
			var replicas uint64
			require.NoError(t, db.QueryRowContext(ctx,
				"SELECT count() FROM clusterAllReplicas(?, system.databases) WHERE name = ? AND engine = 'Replicated'", config.Cluster, config.Database).Scan(&replicas))
			require.EqualValues(t, len(config.Hosts), replicas)
		})
	}
	if !ran {
		t.Skip("requires a replicated ClickHouse configuration")
	}
}

func TestReplicatedDatabaseBootstrap(t *testing.T) {
	ran := false
	for _, fixture := range []*clickhouse_replicated_db.ClickHouseReplicatedDBContainer{clickhouseReplicatedDBContainer, clickhouseReplicatedDBShardedContainer} {
		if fixture == nil {
			continue
		}
		ran = true
		for _, protocol := range []ClickHouseProtocol{ClickHouseProtocolNative, ClickHouseProtocolHTTP} {
			t.Run(fmt.Sprintf("%d_nodes_%s", len(fixture.Hosts), protocol), func(t *testing.T) {
				ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
				defer cancel()
				hosts := fixture.Hosts
				if protocol == ClickHouseProtocolHTTP {
					hosts = fixture.HostsHTTP
				}
				config := ClickHouseConfig{
					Hosts:          hosts,
					Protocol:       protocol,
					Username:       "default",
					Database:       "bootstrap-" + string(protocol) + "_" + uuid.NewLettersNumbers(),
					Cluster:        fixture.Cluster,
					DatabaseEngine: DatabaseEngineReplicated,
				}
				instance, err := NewClickHouse(bulker.Config{Id: "bootstrap", DestinationConfig: config})
				if instance != nil {
					t.Cleanup(func() { require.NoError(t, instance.Close()) })
				}
				require.NoError(t, err)
				ch := instance.(*ClickHouse)
				require.NoError(t, ch.InitDatabase(ctx))
				stream, err := ch.CreateStream("bootstrap", "events", bulker.Stream)
				require.NoError(t, err)
				_, _, err = stream.ConsumeJSON(ctx, []byte(`{"id":1}`))
				require.NoError(t, err)
				_, err = stream.Complete(ctx)
				require.NoError(t, err)
				var databases, tables uint64
				require.NoError(t, ch.dataSource.QueryRowContext(ctx,
					"SELECT count() FROM clusterAllReplicas(?, system.databases) WHERE name = ? AND engine = 'Replicated'", config.Cluster, config.Database).Scan(&databases))
				require.EqualValues(t, len(hosts), databases)
				require.NoError(t, ch.dataSource.QueryRowContext(ctx,
					"SELECT count() FROM clusterAllReplicas(?, system.tables) WHERE database = ? AND name = ? AND engine = 'ReplicatedMergeTree'", config.Cluster, config.Database, ch.localTableName("events")).Scan(&tables))
				require.EqualValues(t, len(hosts), tables)

				config.DatabaseEngine = DatabaseEngineDefault
				mismatched, err := NewClickHouse(bulker.Config{Id: "default-on-replicated", DestinationConfig: config})
				require.NoError(t, err)
				t.Cleanup(func() { require.NoError(t, mismatched.Close()) })
				require.ErrorContains(t, mismatched.(*ClickHouse).InitDatabase(ctx), "set databaseEngine to replicated")
				config.DatabaseEngine = DatabaseEngineReplicated

				config.Database = "default"
				atomic, err := NewClickHouse(bulker.Config{Id: "wrong-engine", DestinationConfig: config})
				require.NoError(t, err)
				t.Cleanup(func() { require.NoError(t, atomic.Close()) })
				require.ErrorContains(t, atomic.(*ClickHouse).InitDatabase(ctx), `got "Atomic"`)
			})
		}
	}
	if !ran {
		t.Skip("requires a replicated ClickHouse configuration")
	}
}

func TestClickHouseDatabaseLifecycle(t *testing.T) {
	ran := false
	for _, id := range []string{"clickhouse_replicated_db", "clickhouse_replicated_db_sharded"} {
		registered, ok := configRegistry[id]
		if !ok {
			continue
		}
		ran = true
		for _, databaseEngine := range []ClickHouseDatabaseEngine{DatabaseEngineDefault, DatabaseEngineReplicated} {
			t.Run(id+"/"+string(databaseEngine), func(t *testing.T) {
				config := registered.Config.(ClickHouseConfig)
				config.DatabaseEngine = databaseEngine
				if databaseEngine == DatabaseEngineDefault {
					config.Database = "default"
				}
				ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
				defer cancel()
				instance, err := NewClickHouse(bulker.Config{Id: id, DestinationConfig: config})
				require.NoError(t, err)
				ch := instance.(*ClickHouse)
				t.Cleanup(func() { require.NoError(t, ch.Close()) })
				require.NoError(t, ch.InitDatabase(ctx))
				require.Equal(t, strings.HasSuffix(id, "_sharded"), ch.IsDistributed())

				nodes := make([]*sql.DB, 0, len(config.Hosts))
				for _, host := range config.Hosts {
					nodeConfig := config
					nodeConfig.Hosts = []string{host}
					db, err := sql.Open("clickhouse", clickhouseDriverConnectionString(&nodeConfig))
					require.NoError(t, err)
					t.Cleanup(func() { require.NoError(t, db.Close()) })
					nodes = append(nodes, db)
				}

				namespace := "lifecycle_" + string(databaseEngine)
				write := func(table string, mode bulker.BulkMode, first, last int, extra bool, options ...bulker.StreamOption) {
					t.Helper()
					options = append(options, bulker.WithNamespace(namespace), bulker.WithPrimaryKey("id"), bulker.WithDeduplicate())
					stream, err := ch.CreateStream(table, table, mode, options...)
					require.NoError(t, err)
					for n := first; n <= last; n++ {
						event := fmt.Sprintf(`{"id":%d,"name":"row%d"}`, n, n)
						if extra {
							event = fmt.Sprintf(`{"id":%d,"name":"row%d","extra":"added"}`, n, n)
						}
						_, _, err = stream.ConsumeJSON(ctx, []byte(event))
						require.NoError(t, err)
					}
					_, err = stream.Complete(ctx)
					require.NoError(t, err)
				}
				assertRows := func(table string, expected []int) {
					t.Helper()
					local := ch.localTableName(table)
					for _, db := range nodes {
						_, err := db.ExecContext(ctx, "SYSTEM SYNC REPLICA "+namespace+"."+local)
						require.NoError(t, err)
					}
					want := make([]string, len(expected))
					for n, value := range expected {
						want[n] = strconv.Itoa(value)
					}
					for n, db := range nodes {
						var rows, engine string
						require.NoError(t, db.QueryRowContext(ctx,
							"SELECT arrayStringConcat(arrayMap(x -> toString(x), arraySort(groupArray(id))), ',') FROM "+namespace+"."+table+" FINAL").Scan(&rows))
						require.Equal(t, strings.Join(want, ","), rows, "node %d", n)
						require.NoError(t, db.QueryRowContext(ctx,
							"SELECT engine FROM system.tables WHERE database = ? AND name = ?", namespace, local).Scan(&engine))
						require.Equal(t, "ReplicatedReplacingMergeTree", engine)
					}
				}
				ids := func(first, last int) []int {
					var values []int
					for n := first; n <= last; n++ {
						values = append(values, n)
					}
					return values
				}

				write("events", bulker.Batch, 1, 16, false)
				write("events", bulker.Stream, 17, 32, true)
				assertRows("events", ids(1, 32))
				for _, db := range nodes {
					var engine string
					var columns, localRows uint64
					require.NoError(t, db.QueryRowContext(ctx, "SELECT engine FROM system.databases WHERE name = ?", namespace).Scan(&engine))
					if databaseEngine == DatabaseEngineReplicated {
						require.Equal(t, "Replicated", engine)
					} else {
						require.Equal(t, "Atomic", engine)
					}
					require.NoError(t, db.QueryRowContext(ctx,
						"SELECT count() FROM system.columns WHERE database = ? AND table = ? AND name = 'extra'", namespace, ch.localTableName("events")).Scan(&columns))
					require.EqualValues(t, 1, columns)
					require.NoError(t, db.QueryRowContext(ctx, "SELECT count() FROM "+namespace+"."+ch.localTableName("events")+" FINAL").Scan(&localRows))
					require.Positive(t, localRows, "each shard must receive data")
				}

				write("events", bulker.ReplaceTable, 201, 216, false)
				assertRows("events", ids(201, 216))
				write("events", bulker.ReplaceTable, 1, 0, false)
				assertRows("events", nil)
				write("renamed", bulker.ReplaceTable, 301, 316, false)
				assertRows("renamed", ids(301, 316))

				write("partitions", bulker.ReplacePartition, 1, 16, false, bulker.WithPartition("first"))
				write("partitions", bulker.ReplacePartition, 17, 32, false, bulker.WithPartition("second"))
				assertRows("partitions", ids(1, 32))
				write("partitions", bulker.ReplacePartition, 101, 102, false, bulker.WithPartition("first"))
				assertRows("partitions", append(ids(17, 32), 101, 102))
				write("partitions", bulker.ReplacePartition, 1, 0, false, bulker.WithPartition("second"))
				assertRows("partitions", ids(101, 102))

				for _, table := range []string{"events", "renamed", "partitions"} {
					require.NoError(t, ch.DropTable(ctx, namespace, table, false))
					for _, db := range nodes {
						var count uint64
						require.NoError(t, db.QueryRowContext(ctx,
							"SELECT count() FROM system.tables WHERE database = ? AND name IN (?, ?)", namespace, table, ch.localTableName(table)).Scan(&count))
						require.Zero(t, count)
					}
				}
			})
		}
	}
	if !ran {
		t.Skip("requires a replicated ClickHouse configuration")
	}
}

func TestReplicatedDatabaseBootstrapWithoutDefault(t *testing.T) {
	ran := false
	for _, id := range []string{"clickhouse_replicated_db", "clickhouse_replicated_db_sharded"} {
		registered, ok := configRegistry[id]
		if !ok {
			continue
		}
		ran = true
		t.Run(id, func(t *testing.T) {
			config := registered.Config.(ClickHouseConfig)
			ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
			defer cancel()
			for _, host := range config.Hosts {
				admin := config
				admin.Database = "system"
				admin.Hosts = []string{host}
				db, err := sql.Open("clickhouse", clickhouseDriverConnectionString(&admin))
				require.NoError(t, err)
				t.Cleanup(func() {
					restoreCtx, restoreCancel := context.WithTimeout(context.Background(), time.Minute)
					defer restoreCancel()
					_, err := db.ExecContext(restoreCtx, "CREATE DATABASE IF NOT EXISTS default")
					require.NoError(t, err)
					require.NoError(t, db.Close())
				})
				_, err = db.ExecContext(ctx, "DROP DATABASE default SYNC")
				require.NoError(t, err)
			}
			config.Database = "bootstrap_no_default_" + uuid.NewLettersNumbers()
			instance, err := NewClickHouse(bulker.Config{Id: "bootstrap-no-default", DestinationConfig: config})
			if instance != nil {
				t.Cleanup(func() { require.NoError(t, instance.Close()) })
			}
			require.NoError(t, err)
			require.NoError(t, instance.(*ClickHouse).InitDatabase(ctx))
		})
	}
	if !ran {
		t.Skip("requires a replicated ClickHouse configuration")
	}
}

func TestReplicatedDatabaseAuthenticationError(t *testing.T) {
	ran := false
	for _, fixture := range []*clickhouse_replicated_db.ClickHouseReplicatedDBContainer{clickhouseReplicatedDBContainer, clickhouseReplicatedDBShardedContainer} {
		if fixture == nil {
			continue
		}
		ran = true
		for _, protocol := range []ClickHouseProtocol{ClickHouseProtocolNative, ClickHouseProtocolHTTP} {
			t.Run(fmt.Sprintf("%d_nodes_%s", len(fixture.Hosts), protocol), func(t *testing.T) {
				hosts := fixture.Hosts
				if protocol == ClickHouseProtocolHTTP {
					hosts = fixture.HostsHTTP
				}
				config := ClickHouseConfig{Hosts: hosts, Protocol: protocol, Username: "default", Password: "incorrect-password", Database: "missing_auth_test", Cluster: fixture.Cluster, DatabaseEngine: DatabaseEngineReplicated}
				instance, err := NewClickHouse(bulker.Config{Id: "invalid-auth", DestinationConfig: config})
				if instance != nil {
					t.Cleanup(func() { require.NoError(t, instance.Close()) })
				}
				require.Error(t, err)
				require.NotContains(t, err.Error(), "database bootstrap")
			})
		}
	}
	if !ran {
		t.Skip("requires a replicated ClickHouse configuration")
	}
}
