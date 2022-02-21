package adapters

import (
	"context"
	"fmt"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/test"
	"github.com/jitsucom/jitsu/server/typing"
	uuid "github.com/satori/go.uuid"
	"github.com/stretchr/testify/require"
	"gotest.tools/assert"
	"math/rand"
	"testing"
)

func TestDeduplicateObjects(t *testing.T) {
	table := &Table{
		Name:     "test_deduplicate",
		Columns:  Columns{"field1": typing.SQLColumn{Type: "text"}, "field2": typing.SQLColumn{Type: "text"}, "field3": typing.SQLColumn{Type: "bigint"}, "user": typing.SQLColumn{Type: "text"}},
		PKFields: map[string]bool{"field1": true, "field2": true},
	}

	//no duplications
	oneBucket := deduplicateObjects(table, []map[string]interface{}{
		{"field1": "1", "field2": "2", "field3": "3"},
		{"field1": "1", "field2": "22", "field3": "4"},
		{"field1": "11", "field2": "2", "field3": "5"},
	})
	require.Equal(t, 1, len(oneBucket))

	//3 duplications
	threeBuckets := deduplicateObjects(table, []map[string]interface{}{
		{"field1": "1", "field2": "2", "field3": "3"},
		{"field1": "1", "field2": "2", "field3": "4"},
		{"field1": "1", "field2": "2", "field3": "5"},
	})
	require.Equal(t, 3, len(threeBuckets))

	//3 duplications
	threeBucketsAgain := deduplicateObjects(table, []map[string]interface{}{
		{"field1": "1", "field2": "2", "field3": "3"},
		{"field1": "1", "field2": "2", "field3": "4"},
		{"field1": "1", "field2": "2", "field3": "5"},
		{"field1": "1", "field2": "22", "field3": "4"},
		{"field1": "1", "field2": "22", "field3": "5"},
	})
	require.Equal(t, 3, len(threeBucketsAgain))
}

func TestPostgresTruncateExistingTable(t *testing.T) {
	table := &Table{
		Name:    "test_truncate_existing_table",
		Columns: Columns{"field1": typing.SQLColumn{Type: "text"}, "field2": typing.SQLColumn{Type: "text"}, "field3": typing.SQLColumn{Type: "bigint"}, "user": typing.SQLColumn{Type: "text"}},
	}
	container, pg := setupDatabase(t, table)
	defer container.Close()
	err := pg.insertBatch(table, createObjects(5), nil)
	require.NoError(t, err, "Failed to bulk insert 5 objects")
	rows, err := container.CountRows(table.Name)
	require.NoError(t, err, "Failed to count objects at "+table.Name)
	assert.Equal(t, rows, 5)
	err = pg.Truncate(table.Name)
	require.NoError(t, err, "Failed to truncate table")
	rows, err = container.CountRows(table.Name)
	require.NoError(t, err, "Failed to count objects at "+table.Name)
	assert.Equal(t, rows, 0)
}

func TestPostgresTruncateNonexistentTable(t *testing.T) {
	container, pg := setupDatabase(t, nil)
	defer container.Close()
	err := pg.Truncate(uuid.NewV4().String())
	require.Contains(t, err.Error(), "table doesn't exist")
}

func setupDatabase(t *testing.T, table *Table) (*test.PostgresContainer, *Postgres) {
	ctx := context.Background()
	container, err := test.NewPostgresContainer(ctx)
	if err != nil {
		t.Fatalf("failed to initialize container: %v", err)
	}
	dsConfig := &DataSourceConfig{Host: container.Host, Port: container.Port, Username: container.Username, Password: container.Password, Db: container.Database, Schema: container.Schema, Parameters: map[string]string{"sslmode": "disable"}}
	pg, err := NewPostgres(ctx, dsConfig, &logging.QueryLogger{}, typing.SQLTypes{})
	if err != nil {
		t.Fatalf("Failed to create Postgres adapter: %v", err)
	}
	if table != nil {
		err = pg.CreateTable(table)
		require.NoError(t, err, "Failed to create table")
	}
	return container, pg
}

func createObjects(num int) []map[string]interface{} {
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
