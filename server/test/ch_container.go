package test

import (
	"context"
	"database/sql"
	"fmt"
	"github.com/docker/go-connections/nat"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/testcontainers/testcontainers-go"
	tcWait "github.com/testcontainers/testcontainers-go/wait"
	"os"
	"runtime"
	"strconv"
	"time"
)

const (
	chDatabase           = "default"
	chDatasourceTemplate = "http://default:@localhost:%d/default?read_timeout=5m&timeout=5m&enable_http_compression=1"

	envClickhousePortVariable = "CH_TEST_PORT"
)

//ClickHouseContainer is a ClickHouse testcontainer
type ClickHouseContainer struct {
	datasource *sql.DB
	Container  testcontainers.Container
	Context    context.Context

	Port     int
	Dsns     []string
	Database string
}

//NewClickhouseContainer creates new Clickhouse test container if CH_TEST_PORT is not defined. Otherwise uses db at defined port.
//This logic is required for running test at CI environment
func NewClickhouseContainer(ctx context.Context) (*ClickHouseContainer, error) {
	if os.Getenv(envClickhousePortVariable) != "" {
		port, err := strconv.Atoi(os.Getenv(envClickhousePortVariable))
		if err != nil {
			return nil, err
		}
		dsn := fmt.Sprintf(chDatasourceTemplate, port)

		datasource, err := sql.Open("clickhouse", dsn)
		if err != nil {
			return nil, err
		}

		return &ClickHouseContainer{
			datasource: datasource,
			Context:    ctx,
			Dsns:       []string{dsn},
			Database:   chDatabase,
			Port:       port,
		}, nil
	}
	dbURL := func(port nat.Port) string {
		return fmt.Sprintf(chDatasourceTemplate, port.Int())
	}
	image := "yandex/clickhouse-server:20.3"
	if runtime.GOARCH == "arm64" {
		image = "altinity/clickhouse-server:20.10.1.4844-testing-arm"
	}

	container, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: testcontainers.ContainerRequest{
			Image:        image,
			ExposedPorts: []string{"8123/tcp", "9000/tcp"},
			WaitingFor:   tcWait.ForSQL("8123/tcp", "clickhouse", dbURL).Timeout(time.Second * 60),
		},
		Started: true,
	})
	if err != nil {
		return nil, err
	}

	port, err := container.MappedPort(ctx, "8123")
	if err != nil {
		container.Terminate(ctx)
		return nil, err
	}

	dsn := fmt.Sprintf(chDatasourceTemplate, port.Int())

	datasource, err := sql.Open("clickhouse", dsn)
	if err != nil {
		container.Terminate(ctx)
		return nil, err
	}

	return &ClickHouseContainer{
		datasource: datasource,
		Container:  container,
		Context:    ctx,
		Dsns:       []string{dsn},
		Database:   chDatabase,
		Port:       port.Int(),
	}, nil
}

//CountRows returns row count in DB table with name = table
//or error if occurred
func (ch *ClickHouseContainer) CountRows(table string) (int, error) {
	rows, err := ch.datasource.Query(fmt.Sprintf("SELECT count(*) from %s final", table))
	if err != nil {
		return -1, err
	}
	defer rows.Close()
	rows.Next()
	var count int
	err = rows.Scan(&count)
	return count, err
}

func (ch *ClickHouseContainer) GetSortedRows(table, selectClause, whereClause, orderClause string) ([]map[string]interface{}, error) {
	where := ""
	if whereClause != "" {
		where = "where " + whereClause
	}

	rows, err := ch.datasource.Query(fmt.Sprintf("SELECT %s from %s %s %s", selectClause, table, where, orderClause))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return extractData(rows)
}

//Close terminates underlying docker container
func (ch *ClickHouseContainer) Close() error {
	if ch.Container != nil {
		if err := ch.Container.Terminate(ch.Context); err != nil {
			logging.Errorf("Failed to stop ch container: %v", err)
		}
	}

	if ch.datasource != nil {
		if err := ch.datasource.Close(); err != nil {
			logging.Errorf("failed to close datasource in clickhouse container: %v", err)
		}
	}

	return nil
}
