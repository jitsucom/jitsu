package sql

import (
	bulker "github.com/jitsucom/bulker/bulkerlib"
	"github.com/jitsucom/bulker/bulkerlib/types"
	"github.com/jitsucom/bulker/jitsubase/utils"
	"sync"
	"testing"
)

// TestSchemaOptionNestedObject verifies that a non-root nested object (context.headers)
// declared in the Schema stream option with the agnostic JSON data type is kept as a
// single column instead of being flattened into one column per key.
func TestSchemaOptionNestedObject(t *testing.T) {
	t.Parallel()
	schema := types.Schema{Fields: []types.SchemaField{{Name: "context_headers", Type: types.JSON}}}
	tests := []bulkerTestConfig{
		{
			//deletes any table leftovers from previous tests
			name:      "dummy_test_table_cleanup",
			tableName: "schema_option_nested_test",
			modes:     []bulker.BulkMode{bulker.Batch, bulker.Stream},
			dataFile:  "test_data/empty.ndjson",
			configIds: utils.ArrayIntersection(allBulkerConfigs, []string{PostgresBulkerTypeId, MySQLBulkerTypeId}),
		},
		{
			// in batch mode schema columns are added to the table ahead of event columns
			name:      "nested_object_as_single_json_column_batch",
			tableName: "schema_option_nested_test",
			modes:     []bulker.BulkMode{bulker.Batch},
			dataFile:  "test_data/context_headers.ndjson",
			expectedTable: ExpectedTable{
				Columns: justColumns("context_headers", "_timestamp", "id", "name", "context_ip"),
			},
			expectedRowsCount: 2,
			configIds:         utils.ArrayIntersection(allBulkerConfigs, []string{PostgresBulkerTypeId, MySQLBulkerTypeId}),
			streamOptions:     []bulker.StreamOption{bulker.WithSchema(schema)},
		},
		{
			name:      "nested_object_as_single_json_column_stream",
			tableName: "schema_option_nested_test",
			modes:     []bulker.BulkMode{bulker.Stream},
			dataFile:  "test_data/context_headers.ndjson",
			expectedTable: ExpectedTable{
				Columns: justColumns("_timestamp", "id", "name", "context_ip", "context_headers"),
			},
			expectedRowsCount: 2,
			configIds:         utils.ArrayIntersection(allBulkerConfigs, []string{PostgresBulkerTypeId, MySQLBulkerTypeId}),
			streamOptions:     []bulker.StreamOption{bulker.WithSchema(schema)},
		},
		{
			// with toSameCase the flattened key paths are name-transformed, so schema-derived
			// notFlatteningKeys must be transformed the same way to match (sync-sidecar combines
			// WithSchema with WithToSameCase; on Snowflake every path is transformed to upper case)
			name:      "nested_object_schema_with_to_same_case",
			tableName: "schema_option_nested_test",
			modes:     []bulker.BulkMode{bulker.Stream},
			dataFile:  "test_data/context_headers_mixed_case.ndjson",
			expectedTable: ExpectedTable{
				Columns: justColumns("_timestamp", "id", "name", "context_ip", "context_headers"),
			},
			expectedRowsCount: 2,
			configIds:         utils.ArrayIntersection(allBulkerConfigs, []string{PostgresBulkerTypeId, MySQLBulkerTypeId}),
			streamOptions: []bulker.StreamOption{
				bulker.WithSchema(types.Schema{Fields: []types.SchemaField{{Name: "context_Headers", Type: types.JSON}}}),
				bulker.WithToSameCase(),
			},
		},
	}
	sequentialGroup := sync.WaitGroup{}
	sequentialGroup.Add(1)
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			runTestConfig(t, tt, testStream)
			sequentialGroup.Done()
		})
		sequentialGroup.Wait()
		sequentialGroup.Add(1)
	}
}
