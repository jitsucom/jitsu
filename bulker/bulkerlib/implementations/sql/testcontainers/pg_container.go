package testcontainers

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/jitsucom/bulker/jitsubase/logging"
	"github.com/jitsucom/bulker/jitsubase/utils"
	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/api/types/network"
	"github.com/testcontainers/testcontainers-go"
	tcWait "github.com/testcontainers/testcontainers-go/wait"
)

const (
	pgUser     = "test"
	pgPassword = "test"
	pgDatabase = "test"
	pgSchema   = "bulker"

	envPostgresPortVariable = "PG_TEST_PORT"
)

// PostgresContainer is a Postgres testcontainer
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

// NewPostgresContainer creates new Postgres test container if PG_TEST_PORT is not defined. Otherwise uses db at defined port. This logic is required
// for running test at CI environment
func NewPostgresContainer(ctx context.Context) (*PostgresContainer, error) {
	if os.Getenv(envPostgresPortVariable) != "" {
		port, err := strconv.Atoi(os.Getenv(envPostgresPortVariable))
		if err != nil {
			return nil, err
		}

		connectionString := fmt.Sprintf("host=%s port=%d dbname=%s user=%s password=%s sslmode=disable",
			"localhost", port, pgDatabase, pgUser, pgPassword)
		dataSource, err := sql.Open("pgx", connectionString)
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
	dbURL := func(host string, port string) string {
		port = strings.Split(port, "/")[0]
		return fmt.Sprintf("postgres://%s:%s@%s:%s/%s?sslmode=disable", pgUser, pgPassword, host, port, pgDatabase)
	}

	hostPort := fmt.Sprintf("%d", utils.GetPort())

	container, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: testcontainers.ContainerRequest{
			Image:        "postgres:12-alpine",
			ExposedPorts: []string{"5432/tcp"},
			HostConfigModifier: func(hc *container.HostConfig) {
				hc.PortBindings = network.PortMap{
					network.MustParsePort("5432/tcp"): []network.PortBinding{{HostPort: hostPort}},
				}
			},
			Env:        dbSettings,
			WaitingFor: tcWait.ForSQL("5432", "pgx", dbURL).WithStartupTimeout(time.Second * 60),
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
		host, port.Num(), pgDatabase, pgUser, pgPassword)
	logging.Infof("testcontainters postgres connection string: %s", connectionString)
	dataSource, err := sql.Open("pgx", connectionString)
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
		Port:       int(port.Num()),
		Schema:     pgSchema,
		Database:   pgDatabase,
		Username:   pgUser,
		Password:   pgPassword,
	}, nil
}

// CountRows returns row count in DB table with name = table
// or error if occurred
func (pgc *PostgresContainer) CountRows(table string) (int, error) {
	rows, err := pgc.datasource.Query(fmt.Sprintf("SELECT count(*) from %s", table))
	if err != nil {
		errMessage := err.Error()
		if strings.HasPrefix(errMessage, "ERROR: relation") && strings.HasSuffix(errMessage, "does not exist (SQLSTATE 42P01)") {
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

// GetSortedRows returns all selected row from table ordered according to orderClause
// or error if occurred
func (pgc *PostgresContainer) GetSortedRows(table, selectClause, whereClause, orderClause string) ([]map[string]any, error) {
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

func extractData(rows *sql.Rows) ([]map[string]interface{}, error) {
	cols, _ := rows.Columns()

	objects := []map[string]interface{}{}
	for rows.Next() {
		columns := make([]interface{}, len(cols))
		columnPointers := make([]interface{}, len(cols))
		for i := range columns {
			columnPointers[i] = &columns[i]
		}

		// Scan the result into the column pointers...
		if err := rows.Scan(columnPointers...); err != nil {
			return nil, err
		}

		// Create our map, and retrieve the value for each column from the pointers slice,
		// storing it in the map with the name of the column as the key.
		object := make(map[string]interface{})
		for i, colName := range cols {
			val := columnPointers[i].(*interface{})
			object[colName] = *val
		}

		objects = append(objects, object)
	}

	return objects, nil
}

// Close terminates underlying postgres docker container
func (pgc *PostgresContainer) Close() error {
	logging.Infof("terminating postgres container")
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

func (pgc *PostgresContainer) Stop() error {
	return pgc.Container.Stop(context.Background(), nil)
}

func (pgc *PostgresContainer) Start() error {
	err := pgc.Container.Start(context.Background())
	if err != nil {
		return err
	}
	port, err := pgc.Container.MappedPort(context.Background(), "5432")
	if err != nil {
		return err
	}
	fmt.Printf("Postgres container started on port: %d\n", port.Num())
	return nil
}
