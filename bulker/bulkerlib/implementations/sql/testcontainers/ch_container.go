package testcontainers

import (
	"context"
	"fmt"
	"time"

	"github.com/jitsucom/bulker/jitsubase/logging"
	"github.com/jitsucom/bulker/jitsubase/utils"
	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/api/types/network"
	"github.com/testcontainers/testcontainers-go"
	tcWait "github.com/testcontainers/testcontainers-go/wait"
)

const (
	chDatabase                = "default"
	envClickhousePortVariable = "CH_TEST_PORT"
)

// ClickHouseContainer is a ClickHouse testcontainer
type ClickHouseContainer struct {
	Container testcontainers.Container
	Context   context.Context

	Hosts    []string
	Database string
}

// NewClickhouseContainer creates new Clickhouse test container if CH_TEST_PORT is not defined. Otherwise uses db at defined port.
// This logic is required for running test at CI environment
func NewClickhouseContainer(ctx context.Context) (*ClickHouseContainer, error) {
	image := "clickhouse/clickhouse-server:25.4-alpine"
	hostPort := fmt.Sprintf("%d", utils.GetPort())

	container, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: testcontainers.ContainerRequest{
			Image:        image,
			ExposedPorts: []string{"9000/tcp"},
			HostConfigModifier: func(hc *container.HostConfig) {
				hc.PortBindings = network.PortMap{
					network.MustParsePort("9000/tcp"): []network.PortBinding{{HostPort: hostPort}},
				}
			},
			WaitingFor: tcWait.ForListeningPort("9000/tcp").WithStartupTimeout(1 * time.Minute),
			Env: map[string]string{
				"CLICKHOUSE_USER":            "default",
				"CLICKHOUSE_SKIP_USER_SETUP": "1",
			},
		},
		Started: true,
	})
	if err != nil {
		return nil, err
	}

	port, err := container.MappedPort(ctx, "9000")
	if err != nil {
		container.Terminate(ctx)
		return nil, err
	}

	return &ClickHouseContainer{
		Container: container,
		Context:   ctx,
		Hosts:     []string{fmt.Sprintf("localhost:%d", port.Num())},
		Database:  chDatabase,
	}, nil
}

//
////CountRows returns row count in DB table with name = table
////or error if occurred
//func (ch *ClickHouseContainer) CountRows(table string) (int, error) {
//	rows, err := ch.datasource.Query(fmt.Sprintf("SELECT count(*) from %s final", table))
//	if err != nil {
//		return -1, err
//	}
//	defer rows.Close()
//	rows.Next()
//	var count int
//	err = rows.Scan(&count)
//	return count, err
//}
//
//func (ch *ClickHouseContainer) GetSortedRows(table, selectClause, whereClause, orderClause string) ([]map[string]interface{}, error) {
//	where := ""
//	if whereClause != "" {
//		where = "where " + whereClause
//	}
//
//	rows, err := ch.datasource.Query(fmt.Sprintf("SELECT %s from %s %s %s", selectClause, table, where, orderClause))
//	if err != nil {
//		return nil, err
//	}
//	defer rows.Close()
//
//	return extractData(rows)
//}

// Close terminates underlying docker container
func (ch *ClickHouseContainer) Close() error {
	if ch.Container != nil {
		if err := ch.Container.Terminate(ch.Context); err != nil {
			logging.Errorf("Failed to stop ch container: %v", err)
		}
	}

	return nil
}

func (ch *ClickHouseContainer) Stop() error {
	return ch.Container.Stop(context.Background(), nil)
}

func (ch *ClickHouseContainer) Start() error {
	return ch.Container.Start(context.Background())
}
