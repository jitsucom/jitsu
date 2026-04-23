package clickhouse_replicated_db

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/jitsucom/bulker/jitsubase/logging"
	"github.com/testcontainers/testcontainers-go"
	tc "github.com/testcontainers/testcontainers-go/modules/compose"
)

const (
	chDatabase = "jitsu_replicated"
	chCluster  = "replicated_cluster"
)

var (
	chHostsHTTP   = []string{"localhost:8223", "localhost:8224"}
	chHostsNative = []string{"localhost:9100", "localhost:9101"}
)

// ClickHouseReplicatedDBContainer is a ClickHouse cluster + ZooKeeper testcontainer intended for
// exercising Jitsu's `databaseEngine=replicated` code path. Topology: 1 shard × 2 replicas — enough
// to exercise Replicated-database DDL propagation without straining shared CI resources.
type ClickHouseReplicatedDBContainer struct {
	Identifier string
	Container  testcontainers.Container
	Compose    tc.ComposeStack
	Context    context.Context

	Cluster   string
	Hosts     []string
	HostsHTTP []string
	Database  string
}

// NewClickhouseReplicatedDBContainer brings up the cluster compose and pre-creates the destination
// database with ENGINE = Replicated so the bulker test suite can connect against it.
func NewClickhouseReplicatedDBContainer(ctx context.Context) (*ClickHouseReplicatedDBContainer, error) {
	composeFilePaths := "testcontainers/clickhouse_replicated_db/docker-compose.yml"
	identifier := "bulker_clickhouse_replicated_db_compose"

	compose, err := tc.NewDockerComposeWith(tc.WithStackFiles(composeFilePaths), tc.StackIdentifier(identifier))
	if err != nil {
		logging.Errorf("couldnt down docker compose: %s : %v", identifier, err)
	}
	err = compose.Down(ctx)
	if err != nil {
		logging.Errorf("couldnt down docker compose: %s : %v", identifier, err)
	}

	compose, err = tc.NewDockerComposeWith(tc.WithStackFiles(composeFilePaths), tc.StackIdentifier(identifier))
	if err != nil {
		return nil, fmt.Errorf("could not run compose file: %v - %v", composeFilePaths, err)
	}
	err = compose.Up(ctx, tc.Wait(true))
	if err != nil {
		return nil, fmt.Errorf("could not run compose file: %v - %v", composeFilePaths, err)
	}
	// Pre-create the destination Replicated database. The ClickHouse Go driver opens its connection
	// against config.Database, which must exist before NewClickHouse can ping. In production users
	// pre-create their Replicated DB; here we mirror that one-time setup so the rest of the bulker
	// test suite (which exercises tables, namespaces, schema changes) starts from the same state.
	if err := createReplicatedDatabase(chHostsHTTP[0], chDatabase, chCluster); err != nil {
		_ = compose.Down(ctx)
		return nil, fmt.Errorf("could not create replicated database: %v", err)
	}
	return &ClickHouseReplicatedDBContainer{
		Identifier: identifier,
		Compose:    compose,
		Context:    ctx,
		Hosts:      chHostsNative,
		HostsHTTP:  chHostsHTTP,
		Database:   chDatabase,
		Cluster:    chCluster,
	}, nil
}

// createReplicatedDatabase issues `CREATE DATABASE IF NOT EXISTS <db> ON CLUSTER <cluster>
// ENGINE = Replicated(...)` against the first node, retrying briefly while the cluster settles.
func createReplicatedDatabase(httpAddr, db, cluster string) error {
	stmt := fmt.Sprintf(
		"CREATE DATABASE IF NOT EXISTS %s ON CLUSTER %s ENGINE = Replicated('/clickhouse/databases/%s', '{shard}', '{replica}')",
		db, cluster, db,
	)
	endpoint := "http://" + httpAddr + "/?" + url.Values{"query": []string{stmt}}.Encode()

	var lastErr error
	deadline := time.Now().Add(60 * time.Second)
	for time.Now().Before(deadline) {
		resp, err := http.Post(endpoint, "text/plain", strings.NewReader(""))
		if err != nil {
			lastErr = err
			time.Sleep(2 * time.Second)
			continue
		}
		body, _ := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if resp.StatusCode == http.StatusOK {
			return nil
		}
		lastErr = fmt.Errorf("status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
		time.Sleep(2 * time.Second)
	}
	return lastErr
}

// Close terminates the underlying compose stack.
func (ch *ClickHouseReplicatedDBContainer) Close() error {
	if ch.Compose != nil {
		execError := ch.Compose.Down(context.Background())
		err := execError.Error
		if err != nil {
			return fmt.Errorf("could down docker compose: %s", ch.Identifier)
		}
	}
	return nil
}
