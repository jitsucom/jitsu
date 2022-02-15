package test

import (
	"context"
	"database/sql"
	"fmt"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/testcontainers/testcontainers-go"
	tcWait "github.com/testcontainers/testcontainers-go/wait"
	"os"
	"strconv"
	"time"
)

const (
	mySQLDefaultPort  = "3306/tcp"
	mySQLRootPassword = "test_root_password"
	mySQLUser         = "test_user"
	mySQLPassword     = "test_password"
	mySQLDatabase     = "test_database"

	envMySQLPortVariable = "MYSQL_TEST_PORT"
)

//MySQLContainer is a MySQL testcontainer
type MySQLContainer struct {
	datasource *sql.DB

	Container testcontainers.Container
	Context   context.Context
	Host      string
	Port      int
	Database  string
	Username  string
	Password  string
}

//NewMySQLContainer creates new MySQL test container if MYSQL_TEST_PORT is not defined. Otherwise uses db at defined port.
//This logic is required for running test at CI environment
func NewMySQLContainer(ctx context.Context) (*MySQLContainer, error) {
	if os.Getenv(envMySQLPortVariable) != "" {
		port, err := strconv.Atoi(os.Getenv(envMySQLPortVariable))
		if err != nil {
			return nil, err
		}

		// [user[:password]@][net[(addr)]]/dbname[?param1=value1&paramN=valueN]
		connectionString := fmt.Sprintf("%s:%s@tcp(%s:%d)/%s",
			mySQLUser, mySQLPassword, "localhpst", port, mySQLDatabase)
		dataSource, err := sql.Open("mysql", connectionString)
		if err != nil {
			return nil, err
		}

		return &MySQLContainer{
			datasource: dataSource,
			Context:    ctx,
			Host:       "localhost",
			Port:       port,
			Database:   mySQLDatabase,
			Username:   mySQLUser,
			Password:   mySQLPassword,
		}, nil
	}
	dbSettings := make(map[string]string, 0)
	dbSettings["MYSQL_ROOT_PASSWORD"] = mySQLRootPassword
	dbSettings["MYSQL_USER"] = mySQLUser
	dbSettings["MYSQL_PASSWORD"] = mySQLPassword
	dbSettings["MYSQL_DATABASE"] = mySQLDatabase

	container, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: testcontainers.ContainerRequest{
			Image:        "mysql/mysql-server:8.0",
			ExposedPorts: []string{mySQLDefaultPort},
			Env:          dbSettings,
			WaitingFor:   tcWait.ForLog("port: 3306  MySQL Community Server - GPL").WithStartupTimeout(time.Second * 180),
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

	port, err := container.MappedPort(ctx, "3306")
	if err != nil {
		container.Terminate(ctx)
		return nil, err
	}

	// [user[:password]@][net[(addr)]]/dbname[?param1=value1&paramN=valueN]
	connectionString := fmt.Sprintf("%s:%s@tcp(%s:%d)/%s",
		mySQLUser, mySQLPassword, host, port.Int(), mySQLDatabase)
	dataSource, err := sql.Open("mysql", connectionString)
	if err != nil {
		container.Terminate(ctx)
		return nil, err
	}

	return &MySQLContainer{
		datasource: dataSource,
		Container:  container,
		Context:    ctx,
		Host:       host,
		Port:       port.Int(),
		Database:   mySQLDatabase,
		Username:   mySQLUser,
		Password:   mySQLPassword,
	}, nil
}

func (mc *MySQLContainer) CountRows(table string) (int, error) {
	rows, err := mc.datasource.Query(fmt.Sprintf("SELECT count(*) FROM %s", table))
	if err != nil {
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
func (mc *MySQLContainer) GetSortedRows(table, selectClause, whereClause, orderClause string) ([]map[string]interface{}, error) {
	where := ""
	if whereClause != "" {
		where = "where " + whereClause
	}
	rows, err := mc.datasource.Query(fmt.Sprintf("SELECT %s from %s %s %s", selectClause, table, where, orderClause))
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
			//MySQL driver specific part
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

//Close terminates underlying mysql docker container
func (mc *MySQLContainer) Close() error {
	if mc.Container != nil {
		err := mc.Container.Terminate(mc.Context)
		if err != nil {
			logging.Errorf("Failed to stop MySQL container: %v", err)
		}
	}

	if mc.datasource != nil {
		if err := mc.datasource.Close(); err != nil {
			logging.Errorf("failed to close datasource in mysql container: %v", err)
		}
	}

	return nil
}
