package adapters

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/test"
	"github.com/jitsucom/jitsu/server/typing"
	uuid "github.com/satori/go.uuid"
	"github.com/stretchr/testify/require"
	"gotest.tools/assert"
	"math/rand"
	"testing"
	"time"
)

var timestamps = [...]time.Time{
	// future after 2038 year
	time.Date(2521, time.July, 10, 10, 50, 10, 17, time.UTC),
	// after 1970 year
	time.Date(2021, time.July, 10, 10, 50, 10, 17, time.UTC),
	// same as time.Time{}
	{},
	// same as time.Time{}
	time.Date(1, 1, 1, 0, 0, 0, 0, time.UTC),
	// before 1970 year
	time.Date(1910, time.July, 10, 10, 50, 10, 17, time.UTC),
}

func TestMySQLBulkInsert(t *testing.T) {
	recordsCount := len(timestamps)
	table := &Table{
		Name: "test_insert",
		Columns: Columns{
			"field1":          Column{SchemaToMySQL[typing.STRING]},
			"field2":          Column{SchemaToMySQL[typing.STRING]},
			"field3":          Column{SchemaToMySQL[typing.INT64]},
			"user":            Column{SchemaToMySQL[typing.STRING]},
			"_interval_start": Column{SchemaToMySQL[typing.TIMESTAMP]},
		},
	}
	container, mySQL := setupMySQLDatabase(t, table)
	defer container.Close()
	err := mySQL.BulkInsert(table, createObjectsForMySQL(recordsCount))
	require.NoError(t, err, fmt.Sprintf("Failed to bulk insert %d objects", recordsCount))
	rows, err := container.CountRows(table.Name)
	require.NoError(t, err, "Failed to count objects at "+table.Name)
	assert.Equal(t, rows, recordsCount)
}

func TestMySQLTruncateExistingTable(t *testing.T) {
	recordsCount := len(timestamps)
	table := &Table{
		Name: "test_truncate_existing_table",
		Columns: Columns{
			"field1":          Column{SchemaToMySQL[typing.STRING]},
			"field2":          Column{SchemaToMySQL[typing.STRING]},
			"field3":          Column{SchemaToMySQL[typing.INT64]},
			"user":            Column{SchemaToMySQL[typing.STRING]},
			"_interval_start": Column{SchemaToMySQL[typing.TIMESTAMP]},
		},
	}
	container, mySQL := setupMySQLDatabase(t, table)
	defer container.Close()
	err := mySQL.BulkInsert(table, createObjectsForMySQL(recordsCount))
	require.NoError(t, err, fmt.Sprintf("Failed to bulk insert %d objects", recordsCount))
	rows, err := container.CountRows(table.Name)
	require.NoError(t, err, "Failed to count objects at "+table.Name)
	assert.Equal(t, rows, recordsCount)
	err = mySQL.Truncate(table.Name)
	require.NoError(t, err, "Failed to truncate table")
	rows, err = container.CountRows(table.Name)
	require.NoError(t, err, "Failed to count objects at "+table.Name)
	assert.Equal(t, rows, 0)
}

func TestMySQLTruncateNonexistentTable(t *testing.T) {
	container, mySQL := setupMySQLDatabase(t, nil)
	defer container.Close()
	err := mySQL.Truncate(uuid.NewV4().String())
	require.ErrorIs(t, err, ErrTableNotExist)
}

func TestMySQLBulkMerge(t *testing.T) {
	recordsCount := len(timestamps)
	table := &Table{
		Name: "test_merge",
		Columns: Columns{
			"field1":          Column{SchemaToMySQL[typing.STRING]},
			"field2":          Column{SchemaToMySQL[typing.STRING]},
			"field3":          Column{SchemaToMySQL[typing.INT64]},
			"user":            Column{SchemaToMySQL[typing.STRING]},
			"_interval_start": Column{SchemaToMySQL[typing.TIMESTAMP]},
		},
		PKFields: map[string]bool{"field1": true},
	}
	container, mySQL := setupMySQLDatabase(t, table)
	defer container.Close()
	// store recordsCount + 3 objects with 3 id duplications, the result must be recordsCount objects
	objects := createObjectsForMySQL(recordsCount)
	objects = append(objects, objects[0])
	objects = append(objects, objects[2])
	objects = append(objects, objects[3])
	err := mySQL.BulkInsert(table, objects)
	require.NoError(t, err, "Failed to bulk merge objects")
	rows, err := container.CountRows(table.Name)
	require.NoError(t, err, "Failed to count objects at "+table.Name)
	assert.Equal(t, rows, recordsCount)
}

func setupMySQLDatabase(t *testing.T, table *Table) (*test.MySQLContainer, *MySQL) {
	ctx := context.Background()
	container, err := test.NewMySQLContainer(ctx)
	if err != nil {
		t.Fatalf("failed to initialize container: %v", err)
	}
	dsConfig := &DataSourceConfig{
		Host:       container.Host,
		Port:       json.Number(fmt.Sprint(container.Port)),
		Username:   container.Username,
		Password:   container.Password,
		Db:         container.Database,
		Parameters: map[string]string{"tls": "false"},
	}
	adapter, err := NewMySQL(ctx, dsConfig, &logging.QueryLogger{}, typing.SQLTypes{})
	if err != nil {
		t.Fatalf("Failed to create MySQL adapter: %v", err)
	}
	if table != nil {
		err = adapter.CreateTable(table)
		require.NoError(t, err, "Failed to create table")
	}
	return container, adapter
}

func createObjectsForMySQL(num int) []map[string]interface{} {
	var objects []map[string]interface{}
	for i := 0; i < num; i++ {
		object := make(map[string]interface{})
		object["field1"] = fmt.Sprintf("100000-%d", i)
		object["field2"] = fmt.Sprint(rand.Int())
		object["field3"] = rand.Int()
		object["user"] = fmt.Sprint(rand.Int())
		object["_interval_start"] = timestamps[i%len(timestamps)]
		objects = append(objects, object)
	}
	return objects
}
