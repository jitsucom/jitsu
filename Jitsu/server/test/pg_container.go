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
	"strconv"
	"strings"
	"time"
)

const (
	pgDefaultPort = "5432/tcp"
	pgUser        = "test"
	pgPassword    = "test"
	pgDatabase    = "test"
	pgSchema      = "public"

	envPostgresPortVariable = "PG_TEST_PORT"
)

//PostgresContainer is a Postgres testcontainer
type PostgresContainer struct {
	datasource *sql.DB

	Container testcontainers.Container
	Context   context.Context
	Host      string
	Port      int
	Database  string
	Schema    string
	Username  string
	Password  string
}

//NewPostgresContainer creates new Postgres test container if PG_TEST_PORT is not defined. Otherwise uses db at defined port. This logic is required
//for running test at CI environment
func NewPostgresContainer(ctx context.Context) (*PostgresContainer, error) {
	if os.Getenv(envPostgresPortVariable) != "" {
		port, err := strconv.Atoi(os.Getenv(envPostgresPortVariable))
		if err != nil {
			return nil, err
		}

		connectionString := fmt.Sprintf("host=%s port=%d dbname=%s user=%s password=%s sslmode=disable",
			"localhost", port, pgDatabase, pgUser, pgPassword)
		dataSource, err := sql.Open("postgres", connectionString)
		if err != nil {
			return nil, err
		}

		if err := dataSource.Ping(); err != nil {
			return nil, err
		}

		return &PostgresContainer{
			Context:  ctx,
			Host:     "localhost",
			Port:     port,
			Schema:   pgSchema,
			Database: pgDatabase,
			Username: pgUser,
			Password: pgPassword,
		}, nil
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
			WaitingFor:   tcWait.ForSQL(pgDefaultPort, "postgres", dbURL).Timeout(time.Second * 60),
		},
		Started: true,
	})
	if err != nil {
		return nil, err
	}

	host, err := container.Host(ctx)
	if err != nil {
		container.Terminate(ctx)
		return nil, err
	}
	port, err := container.MappedPort(ctx, "5432")
	if err != nil {
		container.Terminate(ctx)
		return nil, err
	}

	connectionString := fmt.Sprintf("host=%s port=%d dbname=%s user=%s password=%s sslmode=disable",
		host, port.Int(), pgDatabase, pgUser, pgPassword)
	dataSource, err := sql.Open("postgres", connectionString)
	if err != nil {
		container.Terminate(ctx)
		return nil, err
	}

	if err := dataSource.Ping(); err != nil {
		container.Terminate(ctx)
		return nil, err
	}

	return &PostgresContainer{
		datasource: dataSource,
		Container:  container,
		Context:    ctx,
		Host:       host,
		Port:       port.Int(),
		Schema:     pgSchema,
		Database:   pgDatabase,
		Username:   pgUser,
		Password:   pgPassword,
	}, nil
}

//CountRows returns row count in DB table with name = table
//or error if occurred
func (pgc *PostgresContainer) CountRows(table string) (int, error) {
	rows, err := pgc.datasource.Query(fmt.Sprintf("SELECT count(*) from %s", table))
	if err != nil {
		errMessage := err.Error()
		if strings.HasPrefix(errMessage, "pq: relation") && strings.HasSuffix(errMessage, "does not exist") {
			return 0, err
		}

		return -1, err
	}
	defer rows.Close()
	rows.Next()
	var count int
	err = rows.Scan(&count)
	return count, err
}

//GetSortedRows returns all selected row from table ordered according to orderClause
//or error if occurred
func (pgc *PostgresContainer) GetSortedRows(table, selectClause, whereClause, orderClause string) ([]map[string]interface{}, error) {
	where := ""
	if whereClause != "" {
		where = "where " + whereClause
	}

	rows, err := pgc.datasource.Query(fmt.Sprintf("SELECT %s from %s %s %s", selectClause, table, where, orderClause))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return extractData(rows)
}

//Close terminates underlying postgres docker container
func (pgc *PostgresContainer) Close() error {
	if pgc.Container != nil {
		if err := pgc.Container.Terminate(pgc.Context); err != nil {
			logging.Errorf("Failed to stop postgres container: %v", err)
		}
	}

	if pgc.datasource != nil {
		if err := pgc.datasource.Close(); err != nil {
			logging.Errorf("failed to close datasource in postgres container: %v", err)
		}
	}

	return nil
}
