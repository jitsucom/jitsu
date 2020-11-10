package test

import (
	"context"
	"database/sql"
	"fmt"
	"github.com/docker/go-connections/nat"
	"github.com/jitsucom/eventnative/logging"
	"github.com/testcontainers/testcontainers-go"
	tcWait "github.com/testcontainers/testcontainers-go/wait"
	"os"
	"strconv"
	"time"
)

const (
	pgDefaultPort = "5432/tcp"
	pgUser        = "test"
	pgPassword    = "test"
	pgDatabase    = "test"
	pgSchema      = "public"

	chDatabase           = "default"
	chDatasourceTemplate = "http://default:@localhost:%d/default?read_timeout=5m&timeout=5m&enable_http_compression=1"

	envClickhousePortVariable = "CH_TEST_PORT"
	envPostgresPortVariable   = "PG_TEST_PORT"
)

type PostgresContainer struct {
	Container testcontainers.Container
	Context   context.Context
	Host      string
	Port      int
	Database  string
	Schema    string
	Username  string
	Password  string
}

// Creates new Postgres test container if PG_TEST_PORT is not defined. Otherwise uses db at defined port. This logic is required
// for running test at CI environment
func NewPostgresContainer(ctx context.Context) (*PostgresContainer, error) {
	if os.Getenv(envPostgresPortVariable) != "" {
		port, err := strconv.Atoi(os.Getenv(envPostgresPortVariable))
		if err != nil {
			return nil, err
		}
		return &PostgresContainer{Context: ctx, Host: "localhost", Port: port,
			Schema: pgSchema, Database: pgDatabase, Username: pgUser, Password: pgPassword}, nil
	}
	dbSettings := make(map[string]string, 0)
	dbSettings["POSTGRES_USER"] = pgUser
	dbSettings["POSTGRES_PASSWORD"] = pgPassword
	dbSettings["POSTGRES_DB"] = pgDatabase
	dbURL := func(port nat.Port) string {
		return fmt.Sprintf("postgres://%s:%s@localhost:%s/%s?sslmode=disable", pgUser, pgPassword, port.Port(), pgDatabase)
	}

	container, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: testcontainers.ContainerRequest{
			Image:        "postgres:12-alpine",
			ExposedPorts: []string{pgDefaultPort},
			Env:          dbSettings,
			WaitingFor:   tcWait.ForSQL(pgDefaultPort, "postgres", dbURL).Timeout(time.Second * 15),
		},
		Started: true,
	})
	if err != nil {
		return nil, err
	}
	host, err := container.Host(ctx)
	if err != nil {
		return nil, err
	}
	port, err := container.MappedPort(ctx, "5432")
	if err != nil {
		return nil, err
	}
	return &PostgresContainer{Container: container, Context: ctx, Host: host, Port: port.Int(),
		Schema: pgSchema, Database: pgDatabase, Username: pgUser, Password: pgPassword}, nil
}

func (pgc *PostgresContainer) CountRows(table string) (int, error) {
	connectionString := fmt.Sprintf("host=%s port=%d dbname=%s user=%s password=%s sslmode=disable",
		pgc.Host, pgc.Port, pgc.Database, pgc.Username, pgc.Password)
	dataSource, err := sql.Open("postgres", connectionString)
	if err != nil {
		return -1, err
	}
	rows, err := dataSource.Query(fmt.Sprintf("SELECT count(*) from %s", table))
	if err != nil {
		return -1, err
	}
	defer rows.Close()
	rows.Next()
	var count int
	err = rows.Scan(&count)
	return count, err
}

func (pgc *PostgresContainer) Close() {
	if pgc.Container != nil {
		err := pgc.Container.Terminate(pgc.Context)
		if err != nil {
			logging.Error("Failed to stop container")
		}
	}
}

type ClickHouseContainer struct {
	Container testcontainers.Container
	Context   context.Context

	Port     int
	Dsns     []string
	Database string
}

// Creates new Clickhouse test container if CH_TEST_PORT is not defined. Otherwise uses db at defined port.
//This logic is required for running test at CI environment
func NewClickhouseContainer(ctx context.Context) (*ClickHouseContainer, error) {
	if os.Getenv(envClickhousePortVariable) != "" {
		port, err := strconv.Atoi(os.Getenv(envClickhousePortVariable))
		if err != nil {
			return nil, err
		}
		return &ClickHouseContainer{Context: ctx, Dsns: []string{fmt.Sprintf(chDatasourceTemplate, port)},
			Database: chDatabase, Port: port}, nil
	}
	dbURL := func(port nat.Port) string {
		return fmt.Sprintf(chDatasourceTemplate, port.Int())
	}

	container, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: testcontainers.ContainerRequest{
			Image:        "yandex/clickhouse-server:20.3",
			ExposedPorts: []string{"8123/tcp", "9000/tcp"},
			WaitingFor:   tcWait.ForSQL("8123/tcp", "clickhouse", dbURL).Timeout(time.Second * 15),
		},
		Started: true,
	})
	if err != nil {
		return nil, err
	}
	port, err := container.MappedPort(ctx, "8123")
	if err != nil {
		return nil, err
	}
	return &ClickHouseContainer{Container: container, Context: ctx,
		Dsns: []string{fmt.Sprintf(chDatasourceTemplate, port.Int())}, Database: chDatabase, Port: port.Int()}, nil
}

func (ch *ClickHouseContainer) CountRows(table string) (int, error) {
	dataSource, err := sql.Open("clickhouse", ch.Dsns[0])
	if err != nil {
		return -1, err
	}
	rows, err := dataSource.Query(fmt.Sprintf("SELECT count(*) from %s", table))
	if err != nil {
		return -1, err
	}
	defer rows.Close()
	rows.Next()
	var count int
	err = rows.Scan(&count)
	return count, err
}

func (ch *ClickHouseContainer) Close() {
	if ch.Container != nil {
		err := ch.Container.Terminate(ch.Context)
		if err != nil {
			logging.Error("Failed to stop container")
		}
	}
}
