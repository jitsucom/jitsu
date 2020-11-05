package test

import (
	"context"
	"database/sql"
	"fmt"
	"github.com/docker/go-connections/nat"
	"github.com/ksensehq/eventnative/logging"
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

// Creates new test container if PG_TEST_PORT is not defined. Otherwise uses db at defined port. This logic is required
// for running test at CI environment
func NewPostgresContainer(ctx context.Context) (*PostgresContainer, error) {
	if os.Getenv("PG_TEST_PORT") != "" {
		port, err := strconv.Atoi(os.Getenv("PG_TEST_PORT"))
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
