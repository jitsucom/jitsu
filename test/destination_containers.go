package test

import (
	"context"
	"database/sql"
	"fmt"
	"github.com/docker/go-connections/nat"
	"github.com/ksensehq/eventnative/logging"
	"github.com/testcontainers/testcontainers-go"
	tcWait "github.com/testcontainers/testcontainers-go/wait"
	"net"
	"strconv"
	"time"
)

const (
	pgDefaultPort = "5432/tcp"
	pgUser        = "test"
	pgPassword    = "test"
	pgDatabase    = "test"
	pgSchema      = "public"

	pgMappedPort = 5499
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

// Creates new test container if port 5499 is not used. Otherwise uses Postgres that runs on 5499. That database should
// have predefined user with credentials from pg* constants. This logic is required to run tests on CI environment where
// containers or databases are created via CI server
func NewPostgresContainer(ctx context.Context) (*PostgresContainer, error) {
	if portIsUsed(pgMappedPort) {
		return &PostgresContainer{Context: ctx, Host: "localhost", Port: pgMappedPort,
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

func portIsUsed(port int) bool {
	ln, err := net.Listen("tcp", ":"+strconv.Itoa(port))
	if err != nil {
		logging.Infof("Port [%d] is used", port)
		return true
	}
	logging.Infof("Port [%d] is free", port)
	ln.Close()
	return false
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
