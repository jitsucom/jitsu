package adapters

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/typing"
	"github.com/jitsucom/jitsu/server/uuid"
	"github.com/stretchr/testify/require"
	"math/rand"
	"os"
	"testing"
)

const (
	testSFConfigVar = "TEST_SF_CONFIG"
)

func TestReformatValue(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			"empty input string",
			``,
			``,
		},
		{
			"begin with number",
			`0st`,
			`"0st"`,
		},
		{
			"begin with underscore",
			`_dn`,
			`_dn`,
		},
		{
			"begin with dollar",
			`$qq`,
			`"$qq"`,
		},
		{
			"begin with letter",
			`io`,
			`io`,
		},
		{
			"doesn't contain extended characters",
			`_tableName123$`,
			`_tableName123$`,
		},
		{
			"contains extended characters",
			`my.identifier`,
			`"my.identifier"`,
		},
		{
			"contains spaces",
			`abc bbb`,
			`"abc bbb"`,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			require.Equal(t, tt.expected, reformatValue(tt.input), "Reformatted values aren't equal")
		})
	}
}

func TestReformatToParam(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			"empty input string",
			``,
			``,
		},
		{
			"quoted",
			`"value"`,
			`value`,
		},
		{
			"unquoted",
			`value`,
			`VALUE`,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			require.Equal(t, tt.expected, reformatToParam(tt.input), "Reformatted to param values aren't equal")
		})
	}
}

func TestSFBatchInsert(t *testing.T) {
	sfConfig, skip := readSFConfig(t)
	if skip {
		return
	}

	sf, err := NewSnowflake(context.Background(), sfConfig, nil, &logging.QueryLogger{}, typing.SQLTypes{})
	require.NoError(t, err)
	defer sf.Close()

	table := &Table{
		Name: "test_sf_bulk_insert_" + uuid.NewLettersNumbers(),
		Columns: Columns{"field1": typing.SQLColumn{Type: "text"}, "field2": typing.SQLColumn{Type: "text"}, "field3": typing.SQLColumn{Type: "bigint"},
			"user": typing.SQLColumn{Type: "text"}, "default": typing.SQLColumn{Type: "text"}},
	}
	err = sf.CreateTable(table)
	require.NoError(t, err)

	defer func() {
		tx, _ := sf.OpenTx()
		sf.dropTableInTransaction(tx, table)
		tx.Commit()
	}()

	err = sf.insertBatch(table, createObjectsWithFields([]string{"field1", "field2", "field3", "user", "default"}, 5), nil)
	require.NoError(t, err, "Failed to bulk insert 5 objects")

	rows, err := sf.dataSource.Query(fmt.Sprintf("SELECT count(*) from %s", table.Name))
	require.NoError(t, err)

	defer rows.Close()
	rows.Next()
	var count int
	err = rows.Scan(&count)
	require.NoError(t, err)

	require.Equal(t, count, 5)
}

func TestSFBatchInsert(t *testing.T) {
	sfConfig, skip := readSFConfig(t)
	if skip {
		return
	}

	sf, err := NewSnowflake(context.Background(), sfConfig, nil, &logging.QueryLogger{}, typing.SQLTypes{})
	require.NoError(t, err)
	defer sf.Close()

	table := &Table{
		Name: "test_sf_bulk_update_" + uuid.NewLettersNumbers(),
		Columns: Columns{"field1": typing.SQLColumn{Type: "text"}, "field2": typing.SQLColumn{Type: "text"}, "field3": typing.SQLColumn{Type: "bigint"},
			"user": typing.SQLColumn{Type: "text"}, "default": typing.SQLColumn{Type: "text"}},
		PKFields: map[string]bool{"field1": true},
	}
	err = sf.CreateTable(table)
	require.NoError(t, err)

	defer func() {
		tx, _ := sf.OpenTx()
		sf.dropTableInTransaction(tx, table)
		tx.Commit()
	}()

	// store 8 objects with 3 id duplications, the result must be 5 objects
	objects := createObjectsWithFields([]string{"field1", "field2", "field3", "user", "default"}, 5)
	objects = append(objects, objects[0])
	objects = append(objects, objects[2])
	objects = append(objects, objects[3])

	err = sf.insertBatch(table, objects, nil)
	require.NoError(t, err, "Failed to bulk update 8 objects")

	rows, err := sf.dataSource.Query(fmt.Sprintf("SELECT count(*) from %s", table.Name))
	require.NoError(t, err)

	defer rows.Close()
	rows.Next()
	var count int
	err = rows.Scan(&count)
	require.NoError(t, err)

	require.Equal(t, count, 5)
}

func readSFConfig(t *testing.T) (*SnowflakeConfig, bool) {
	sfConfigJSON := os.Getenv(testSFConfigVar)
	if sfConfigJSON == "" {
		logging.Errorf("OS var %q configuration doesn't exist", testSFConfigVar)
		return nil, true
	}
	sfConfig := &SnowflakeConfig{}
	err := json.Unmarshal([]byte(sfConfigJSON), sfConfig)
	require.NoError(t, err)

	return sfConfig, false
}

func createObjectsWithFields(fields []string, num int) []map[string]interface{} {
	var objects []map[string]interface{}
	for i := 0; i < num; i++ {
		object := make(map[string]interface{})
		for _, field := range fields {
			object[field] = fmt.Sprint(rand.Int())
		}

		objects = append(objects, object)
	}
	return objects
}
