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

	mySQLDefaultPort  = "3306/tcp"
	mySQLRootPassword = "test_root_password"
	mySQLUser         = "test_user"
	mySQLPassword     = "test_password"
	mySQLDatabase     = "test_database"

	chDatabase           = "default"
	chDatasourceTemplate = "http://default:@localhost:%d/default?read_timeout=5m&timeout=5m&enable_http_compression=1"

	envClickhousePortVariable = "CH_TEST_PORT"
	envPostgresPortVariable   = "PG_TEST_PORT"
	envMySQLPortVariable      = "MYSQL_TEST_PORT"
)

//PostgresContainer is a Postgres testcontainer
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

//MySQLContainer is a MySQL testcontainer
type MySQLContainer struct {
	Container testcontainers.Container
	Context   context.Context
	Host      string
	Port      int
	Database  string
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

//NewMySQLContainer creates new MySQL test container if MYSQL_TEST_PORT is not defined. Otherwise uses db at defined port.
//This logic is required for running test at CI environment
func NewMySQLContainer(ctx context.Context) (*MySQLContainer, error) {
	if os.Getenv(envMySQLPortVariable) != "" {
		port, err := strconv.Atoi(os.Getenv(envMySQLPortVariable))
		if err != nil {
			return nil, err
		}
		return &MySQLContainer{Context: ctx, Host: "localhost", Port: port,
			Database: mySQLDatabase, Username: mySQLUser, Password: mySQLPassword}, nil
	}
	dbSettings := make(map[string]string, 0)
	dbSettings["MYSQL_ROOT_PASSWORD"] = mySQLRootPassword
	dbSettings["MYSQL_USER"] = mySQLUser
	dbSettings["MYSQL_PASSWORD"] = mySQLPassword
	dbSettings["MYSQL_DATABASE"] = mySQLDatabase

	container, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: testcontainers.ContainerRequest{
			Image:        "mysql:8.0.25",
			ExposedPorts: []string{mySQLDefaultPort},
			Env:          dbSettings,
			WaitingFor:   tcWait.ForLog("port: 3306  MySQL Community Server - GPL"),
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
	port, err := container.MappedPort(ctx, "3306")
	if err != nil {
		return nil, err
	}
	return &MySQLContainer{Container: container, Context: ctx, Host: host, Port: port.Int(),
		Database: mySQLDatabase, Username: mySQLUser, Password: mySQLPassword}, nil
}

//CountRows returns row count in DB table with name = table
//or error if occurred
func (pgc *PostgresContainer) CountRows(table string) (int, error) {
	connectionString := fmt.Sprintf("host=%s port=%d dbname=%s user=%s password=%s sslmode=disable",
		pgc.Host, pgc.Port, pgc.Database, pgc.Username, pgc.Password)
	dataSource, err := sql.Open("postgres", connectionString)
	if err != nil {
		return -1, err
	}
	rows, err := dataSource.Query(fmt.Sprintf("SELECT count(*) from %s", table))
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

func (mc *MySQLContainer) CountRows(table string) (int, error) {
	// [user[:password]@][net[(addr)]]/dbname[?param1=value1&paramN=valueN]
	connectionString := fmt.Sprintf("%s:%s@tcp(%s:%d)/%s",
		mc.Username, mc.Password, mc.Host, mc.Port, mc.Database)
	dataSource, err := sql.Open("mysql", connectionString)
	if err != nil {
		return -1, err
	}
	rows, err := dataSource.Query(fmt.Sprintf("SELECT count(*) FROM %s", table))
	if err != nil {
		return -1, err
	}
	defer rows.Close()
	rows.Next()
	var count int
	err = rows.Scan(&count)
	return count, err
}

//GetAllSortedRows returns all selected row from table ordered according to orderClause
//or error if occurred
func (pgc *PostgresContainer) GetAllSortedRows(table, orderClause string) ([]map[string]interface{}, error) {
	connectionString := fmt.Sprintf("host=%s port=%d dbname=%s user=%s password=%s sslmode=disable",
		pgc.Host, pgc.Port, pgc.Database, pgc.Username, pgc.Password)
	dataSource, err := sql.Open("postgres", connectionString)
	if err != nil {
		return nil, err
	}
	rows, err := dataSource.Query(fmt.Sprintf("SELECT * from %s %s", table, orderClause))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

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

//GetAllSortedRows returns all selected row from table ordered according to orderClause
//or error if occurred
func (mc *MySQLContainer) GetAllSortedRows(table, orderClause string) ([]map[string]interface{}, error) {
	// [user[:password]@][net[(addr)]]/dbname[?param1=value1&paramN=valueN]
	connectionString := fmt.Sprintf("%s:%s@tcp(%s:%d)/%s",
		mc.Username, mc.Password, mc.Host, mc.Port, mc.Database)
	dataSource, err := sql.Open("mysql", connectionString)
	if err != nil {
		return nil, err
	}
	rows, err := dataSource.Query(fmt.Sprintf("SELECT * from %s %s", table, orderClause))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

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
			val := *(columnPointers[i].(*interface{}))
			if val == nil {
				object[colName] = nil
			} else {
				object[colName] = string((val).([]uint8))
			}
		}

		objects = append(objects, object)
	}

	return objects, nil
}

//Close terminates underlying postgres docker container
func (pgc *PostgresContainer) Close() {
	if pgc.Container != nil {
		err := pgc.Container.Terminate(pgc.Context)
		if err != nil {
			logging.Error("Failed to stop postgres container")
		}
	}
}

//Close terminates underlying mysql docker container
func (mc *MySQLContainer) Close() {
	if mc.Container != nil {
		err := mc.Container.Terminate(mc.Context)
		if err != nil {
			logging.Error("Failed to stop MySQL container")
		}
	}
}

//ClickHouseContainer is a ClickHouse testcontainer
type ClickHouseContainer struct {
	Container testcontainers.Container
	Context   context.Context

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

//CountRows returns row count in DB table with name = table
//or error if occurred
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

//Close terminates underlying docker container
func (ch *ClickHouseContainer) Close() {
	if ch.Container != nil {
		err := ch.Container.Terminate(ch.Context)
		if err != nil {
			logging.Error("Failed to stop container")
		}
	}
}
