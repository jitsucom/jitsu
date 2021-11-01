package adapters

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/typing"
	"github.com/jitsucom/jitsu/server/uuid"
	"github.com/stretchr/testify/require"
	"os"
	"testing"
)

const (
	testRedshiftConfigVar = "TEST_REDSHIFT_CONFIG"
)

func TestRedshiftBulkInsert(t *testing.T) {
	dsConfig, skip := readRedshiftConfig(t)
	if skip {
		return
	}

	redshift, err := NewAwsRedshift(context.Background(), dsConfig, nil, &logging.QueryLogger{}, typing.SQLTypes{})
	require.NoError(t, err)
	defer redshift.Close()

	table := &Table{
		Name: "test_redshift_bulk_insert_" + uuid.NewLettersNumbers(),
		Columns: Columns{"field1": typing.SQLColumn{Type: "text"}, "field2": typing.SQLColumn{Type: "text"}, "field3": typing.SQLColumn{Type: "bigint"},
			"user": typing.SQLColumn{Type: "text"}, "default": typing.SQLColumn{Type: "text"}},
	}
	err = redshift.CreateTable(table)
	require.NoError(t, err)

	defer func() {
		tx, _ := redshift.OpenTx()
		redshift.dataSourceProxy.dropTableInTransaction(tx, table)
		tx.Commit()
	}()

	err = redshift.BulkInsert(table, createObjectsWithFields([]string{"field1", "field2", "field3", "user", "default"}, 5))
	require.NoError(t, err, "Failed to bulk insert 5 objects")

	rows, err := redshift.dataSourceProxy.dataSource.Query(fmt.Sprintf("SELECT count(*) from %s", table.Name))
	require.NoError(t, err)

	defer rows.Close()
	rows.Next()
	var count int
	err = rows.Scan(&count)
	require.NoError(t, err)

	require.Equal(t, count, 5)
}

func TestRedshiftBulkUpdate(t *testing.T) {
	dsConfig, skip := readRedshiftConfig(t)
	if skip {
		return
	}

	redshift, err := NewAwsRedshift(context.Background(), dsConfig, nil, &logging.QueryLogger{}, typing.SQLTypes{})
	require.NoError(t, err)
	defer redshift.Close()

	table := &Table{
		Name: "test_redshift_bulk_update_" + uuid.NewLettersNumbers(),
		Columns: Columns{"field1": typing.SQLColumn{Type: "text"}, "field2": typing.SQLColumn{Type: "text"}, "field3": typing.SQLColumn{Type: "bigint"},
			"user": typing.SQLColumn{Type: "text"}, "default": typing.SQLColumn{Type: "text"}},
		PKFields: map[string]bool{"field1": true},
	}
	err = redshift.CreateTable(table)
	require.NoError(t, err)

	defer func() {
		tx, _ := redshift.OpenTx()
		redshift.dataSourceProxy.dropTableInTransaction(tx, table)
		tx.Commit()
	}()

	// store 8 objects with 3 id duplications, the result must be 5 objects
	objects := createObjectsWithFields([]string{"field1", "field2", "user", "default"}, 5)
	objects = append(objects, objects[0])
	objects = append(objects, objects[2])
	objects = append(objects, objects[3])

	err = redshift.BulkUpdate(table, objects, nil)
	require.NoError(t, err, "Failed to bulk update 8 objects")

	rows, err := redshift.dataSourceProxy.dataSource.Query(fmt.Sprintf("SELECT count(*) from %s", table.Name))
	require.NoError(t, err)

	defer rows.Close()
	rows.Next()
	var count int
	err = rows.Scan(&count)
	require.NoError(t, err)

	require.Equal(t, count, 5)
}

func readRedshiftConfig(t *testing.T) (*DataSourceConfig, bool) {
	sfConfigJSON := os.Getenv(testRedshiftConfigVar)
	if sfConfigJSON == "" {
		logging.Errorf("OS var %q configuration doesn't exist", testRedshiftConfigVar)
		return nil, true
	}
	dsConfig := &DataSourceConfig{}
	err := json.Unmarshal([]byte(sfConfigJSON), dsConfig)
	require.NoError(t, err)

	return dsConfig, false
}
