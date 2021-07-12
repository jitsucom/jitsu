package adapters

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/test"
	"github.com/jitsucom/jitsu/server/typing"
	"github.com/stretchr/testify/require"
	"gotest.tools/assert"
	"math/rand"
	"testing"
)

func TestMySQLBulkInsert(t *testing.T) {
	table := &Table{
		Name: "test_insert",
		Columns: Columns{
			"field1": Column{SchemaToMySQL[typing.INT64]},
			"field2": Column{SchemaToMySQL[typing.STRING]},
			"field3": Column{SchemaToMySQL[typing.STRING]},
			"user":   Column{SchemaToMySQL[typing.STRING]},
		},
	}
	container, mySQL := setupMySQLDatabase(t, table)
	defer container.Close()
	err := mySQL.BulkInsert(table, createObjectsForMySQL(5))
	require.NoError(t, err, "Failed to bulk insert 5 objects")
	rows, err := container.CountRows(table.Name)
	require.NoError(t, err, "Failed to count objects at "+table.Name)
	assert.Equal(t, rows, 5)
}

func TestMySQLBulkMerge(t *testing.T) {
	table := &Table{
		Name: "test_merge",
		Columns: Columns{
			"field1": Column{SchemaToMySQL[typing.INT64]},
			"field2": Column{SchemaToMySQL[typing.STRING]},
			"field3": Column{SchemaToMySQL[typing.STRING]},
			"user":   Column{SchemaToMySQL[typing.STRING]},
		},
		PKFields: map[string]bool{"field1": true},
	}
	container, mySQL := setupMySQLDatabase(t, table)
	defer container.Close()
	// store 8 objects with 3 id duplications, the result must be 5 objects
	objects := createObjectsForMySQL(5)
	objects = append(objects, objects[0])
	objects = append(objects, objects[2])
	objects = append(objects, objects[3])
	err := mySQL.BulkInsert(table, objects)
	require.NoError(t, err, "Failed to bulk merge objects")
	rows, err := container.CountRows(table.Name)
	require.NoError(t, err, "Failed to count objects at "+table.Name)
	assert.Equal(t, rows, 5)
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
		Schema:     container.Database,
		Parameters: map[string]string{"tls": "false"},
	}
	adapter, err := NewMySQL(ctx, dsConfig, &logging.QueryLogger{}, typing.SQLTypes{})
	if err != nil {
		t.Fatalf("Failed to create MySQL adapter: %v", err)
	}
	err = adapter.CreateTable(table)
	require.NoError(t, err, "Failed to create table")
	return container, adapter
}

func createObjectsForMySQL(num int) []map[string]interface{} {
	var objects []map[string]interface{}
	for i := 0; i < num; i++ {
		object := make(map[string]interface{})
		object["field1"] = fmt.Sprint(rand.Int())
		object["field2"] = fmt.Sprint(rand.Int())
		object["field3"] = rand.Int()
		object["user"] = fmt.Sprint(rand.Int())
		objects = append(objects, object)
	}
	return objects
}
