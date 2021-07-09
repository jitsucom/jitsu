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

func TestMysqlBulkInsert(t *testing.T) {
	table := &Table{
		Name: "test_insert",
		Columns: Columns{
			"field1": Column{"MEDIUMTEXT"},
			"field2": Column{"MEDIUMTEXT"},
			"field3": Column{"BIGINT"},
			"user":   Column{"MEDIUMTEXT"},
		},
	}
	container, mysql := setupMysqlDatabase(t, table)
	defer container.Close()
	err := mysql.BulkInsert(table, createObjectsForMysql(5))
	require.NoError(t, err, "Failed to bulk insert 5 objects")
	rows, err := container.CountRows(table.Name)
	require.NoError(t, err, "Failed to count objects at "+table.Name)
	assert.Equal(t, rows, 5)
}

//func TestMysqlBulkMerge(t *testing.T) {
//	table := &Table{
//		Name:     "test_merge",
//		Columns:  Columns{"field1": Column{"text"}, "field2": Column{"text"}, "field3": Column{"bigint"}, "user": Column{"text"}},
//		PKFields: map[string]bool{"field1": true},
//	}
//	container, pg := setupMysqlDatabase(t, table)
//	defer container.Close()
//	// store 8 objects with 3 id duplications, the result must be 5 objects
//	objects := createObjectsForMysql(5)
//	objects = append(objects, objects[0])
//	objects = append(objects, objects[2])
//	objects = append(objects, objects[3])
//	err := pg.BulkInsert(table, objects)
//	require.NoError(t, err, "Failed to bulk merge objects")
//	rows, err := container.CountRows(table.Name)
//	require.NoError(t, err, "Failed to count objects at "+table.Name)
//	assert.Equal(t, rows, 5)
//}

func setupMysqlDatabase(t *testing.T, table *Table) (*test.MysqlContainer, *Mysql) {
	ctx := context.Background()
	container, err := test.NewMysqlContainer(ctx)
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
	adapter, err := NewMysql(ctx, dsConfig, &logging.QueryLogger{}, typing.SQLTypes{})
	if err != nil {
		t.Fatalf("Failed to create Mysql adapter: %v", err)
	}
	err = adapter.CreateTable(table)
	require.NoError(t, err, "Failed to create table")
	return container, adapter
}

func createObjectsForMysql(num int) []map[string]interface{} {
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
