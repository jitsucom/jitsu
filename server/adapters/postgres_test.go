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

func TestBulkInsert(t *testing.T) {
	table := &Table{
		Name:    "test_insert",
		Columns: Columns{"field1": Column{"text"}, "field2": Column{"text"}, "field3": Column{"bigint"}},
	}
	container, pg := setupDatabase(t, table)
	defer container.Close()
	err := pg.BulkInsert(table, createObjects(5))
	require.NoError(t, err, "Failed to bulk insert 5 objects")
	rows, err := container.CountRows(table.Name)
	require.NoError(t, err, "Failed to count objects at "+table.Name)
	assert.Equal(t, rows, 5)
}

func TestBulkMerge(t *testing.T) {
	table := &Table{
		Name:     "test_merge",
		Columns:  Columns{"field1": Column{"text"}, "field2": Column{"text"}, "field3": Column{"bigint"}},
		PKFields: map[string]bool{"field1": true},
	}
	container, pg := setupDatabase(t, table)
	defer container.Close()
	// store 8 objects with 3 id duplications, the result must be 5 objects
	objects := createObjects(5)
	objects = append(objects, objects[0])
	objects = append(objects, objects[2])
	objects = append(objects, objects[3])
	err := pg.BulkInsert(table, objects)
	require.NoError(t, err, "Failed to bulk merge objects")
	rows, err := container.CountRows(table.Name)
	require.NoError(t, err, "Failed to count objects at "+table.Name)
	assert.Equal(t, rows, 5)
}

func setupDatabase(t *testing.T, table *Table) (*test.PostgresContainer, *Postgres) {
	ctx := context.Background()
	container, err := test.NewPostgresContainer(ctx)
	if err != nil {
		t.Fatalf("failed to initialize container: %v", err)
	}
	dsConfig := &DataSourceConfig{Host: container.Host, Port: json.Number(fmt.Sprint(container.Port)), Username: container.Username, Password: container.Password, Db: container.Database, Schema: container.Schema, Parameters: map[string]string{"sslmode": "disable"}}
	pg, err := NewPostgres(ctx, dsConfig, &logging.QueryLogger{}, typing.SQLTypes{})
	if err != nil {
		t.Fatalf("Failed to create Postgres adapter: %v", err)
	}
	err = pg.CreateTable(table)
	require.NoError(t, err, "Failed to create table")
	return container, pg
}

func createObjects(num int) []map[string]interface{} {
	var objects []map[string]interface{}
	for i := 0; i < num; i++ {
		object := make(map[string]interface{})
		object["field1"] = fmt.Sprint(rand.Int())
		object["field2"] = fmt.Sprint(rand.Int())
		object["field3"] = rand.Int()
		objects = append(objects, object)
	}
	return objects
}
