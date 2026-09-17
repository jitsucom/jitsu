package clickhouse_replicated_db

import (
	"context"
	"fmt"
	"net"
	"os"

	"github.com/jitsucom/bulker/jitsubase/uuid"
	"github.com/testcontainers/testcontainers-go"
	tc "github.com/testcontainers/testcontainers-go/modules/compose"
)

const (
	chDatabase = "jitsu_replicated"
	chCluster  = "replicated_cluster"
)

// ClickHouseReplicatedDBContainer runs one or two shards with two replicas each.
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

// NewClickhouseReplicatedDBContainer starts a cluster for replicated database tests.
func NewClickhouseReplicatedDBContainer(ctx context.Context) (*ClickHouseReplicatedDBContainer, error) {
	return newClickhouseReplicatedDBContainer(ctx, false)
}

func NewClickhouseReplicatedDBShardedContainer(ctx context.Context) (*ClickHouseReplicatedDBContainer, error) {
	return newClickhouseReplicatedDBContainer(ctx, true)
}

func newClickhouseReplicatedDBContainer(ctx context.Context, sharded bool) (*ClickHouseReplicatedDBContainer, error) {
	composeFilePaths := "testcontainers/clickhouse_replicated_db/docker-compose.yml"
	services := []string{"clickhouse_repl01", "clickhouse_repl02"}
	if sharded {
		composeFilePaths = "testcontainers/clickhouse_replicated_db/docker-compose-sharded.yml"
		services = append(services, "clickhouse_repl03", "clickhouse_repl04")
	}
	identifier := "bulker_replicated_" + uuid.NewLettersNumbers()
	compose, err := tc.NewDockerComposeWith(tc.WithStackFiles(composeFilePaths), tc.StackIdentifier(identifier))
	if err != nil {
		return nil, fmt.Errorf("could not configure compose: %w", err)
	}
	if image := os.Getenv("CLICKHOUSE_TEST_IMAGE"); image != "" {
		compose.WithEnv(map[string]string{"CLICKHOUSE_TEST_IMAGE": image})
	}
	err = compose.Up(ctx, tc.Wait(true))
	if err != nil {
		_ = compose.Down(ctx)
		return nil, fmt.Errorf("could not run compose file: %v - %v", composeFilePaths, err)
	}
	var chHostsHTTP, chHostsNative []string
	for _, service := range services {
		container, err := compose.ServiceContainer(ctx, service)
		if err != nil {
			_ = compose.Down(ctx)
			return nil, err
		}
		host, err := container.Host(ctx)
		if err != nil {
			_ = compose.Down(ctx)
			return nil, err
		}
		httpPort, err := container.MappedPort(ctx, "8123/tcp")
		if err != nil {
			_ = compose.Down(ctx)
			return nil, err
		}
		nativePort, err := container.MappedPort(ctx, "9000/tcp")
		if err != nil {
			_ = compose.Down(ctx)
			return nil, err
		}
		chHostsHTTP = append(chHostsHTTP, net.JoinHostPort(host, httpPort.Port()))
		chHostsNative = append(chHostsNative, net.JoinHostPort(host, nativePort.Port()))
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

// Close terminates the underlying compose stack.
func (ch *ClickHouseReplicatedDBContainer) Close() error {
	if ch.Compose != nil {
		err := ch.Compose.Down(context.Background())
		if err != nil {
			return fmt.Errorf("could not stop compose stack %s: %w", ch.Identifier, err)
		}
	}
	return nil
}
