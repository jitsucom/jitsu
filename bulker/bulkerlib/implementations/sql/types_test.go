package sql

import (
	"sync"
	"testing"
	"time"

	"cloud.google.com/go/bigquery"
	bulker "github.com/jitsucom/bulker/bulkerlib"
	types2 "github.com/jitsucom/bulker/bulkerlib/types"
	"github.com/jitsucom/bulker/jitsubase/jsonorder"
	"github.com/jitsucom/bulker/jitsubase/timestamp"
	"github.com/jitsucom/bulker/jitsubase/utils"
)

func TestTypesMappingAndCollision(t *testing.T) {
	t.Parallel()
	tests := []bulkerTestConfig{
		{
			name:              "types_stream",
			modes:             []bulker.BulkMode{bulker.Stream},
			expectPartitionId: true,
			dataFile:          "test_data/types.ndjson",
			expectedTable: ExpectedTable{
				Columns: justColumns("id", "time1", "time2", "date1", "int_1", "roundfloat", "float1", "intstring", "roundfloatstring", "floatstring", "name", "bool1", "bool2", "boolstring", "arr1", "arr2", "arr3"),
			},
			expectedRows: []map[string]any{
				{"id": 1, "bool1": false, "bool2": true, "boolstring": "true", "float1": 1.2, "floatstring": "1.1", "int_1": 1, "intstring": "1", "roundfloat": 1.0, "roundfloatstring": "1.0", "name": "test", "time1": constantTime, "time2": timestamp.MustParseTime(time.RFC3339Nano, "2022-08-18T14:17:22.375Z"), "date1": "2022-08-18", "arr1": "[]", "arr2": "[1,2,3]", "arr3": "[\"a\",\"b\",\"c\"]"},
				{"id": 2, "bool1": false, "bool2": true, "boolstring": "false", "float1": 1.0, "floatstring": "1.0", "int_1": 1, "intstring": "1", "roundfloat": 1.0, "roundfloatstring": "1.0", "name": "test", "time1": constantTime, "time2": timestamp.MustParseTime(time.RFC3339Nano, "2022-08-18T14:17:22.375Z"), "date1": "2022-08-18", "arr1": "[]", "arr2": "[1,2,3]", "arr3": "[\"a\",\"b\",\"c\"]"},
				{"id": 3, "bool1": false, "bool2": true, "boolstring": "true", "float1": 1.2, "floatstring": "1.1", "int_1": 1, "intstring": "1", "roundfloat": 1.0, "roundfloatstring": "1.0", "name": "test", "time1": constantTime, "time2": timestamp.MustParseTime(time.RFC3339Nano, "2022-08-18T14:17:22.375Z"), "date1": "2022-08-18", "arr1": "[]", "arr2": "[1,2,3]", "arr3": "[\"a\",\"b\",\"c\"]"},
			},
			expectedErrors: map[string]any{"create_stream_bigquery_stream": BigQueryAutocommitUnsupported},
			configIds:      allBulkerConfigs,
		},
		{
			name:              "types_other",
			modes:             []bulker.BulkMode{bulker.Batch, bulker.ReplaceTable, bulker.ReplacePartition},
			expectPartitionId: true,
			dataFile:          "test_data/types.ndjson",
			expectedTable: ExpectedTable{
				Columns: justColumns("id", "time1", "time2", "date1", "int_1", "roundfloat", "float1", "intstring", "roundfloatstring", "floatstring", "name", "bool1", "bool2", "boolstring", "arr1", "arr2", "arr3"),
			},
			expectedRows: []map[string]any{
				{"id": 1, "bool1": false, "bool2": true, "boolstring": "true", "float1": 1.2, "floatstring": "1.1", "int_1": 1.0, "intstring": "1", "roundfloat": 1.0, "roundfloatstring": "1.0", "name": "test", "time1": constantTime, "time2": timestamp.MustParseTime(time.RFC3339Nano, "2022-08-18T14:17:22.375Z"), "date1": "2022-08-18", "arr1": "[]", "arr2": "[1,2,3]", "arr3": "[\"a\",\"b\",\"c\"]"},
				{"id": 2, "bool1": false, "bool2": true, "boolstring": "false", "float1": 1.0, "floatstring": "1.0", "int_1": 1.0, "intstring": "1", "roundfloat": 1.0, "roundfloatstring": "1.0", "name": "test", "time1": constantTime, "time2": timestamp.MustParseTime(time.RFC3339Nano, "2022-08-18T14:17:22.375Z"), "date1": "2022-08-18", "arr1": "[]", "arr2": "[1,2,3]", "arr3": "[\"a\",\"b\",\"c\"]"},
				{"id": 3, "bool1": false, "bool2": true, "boolstring": "true", "float1": 1.2, "floatstring": "1.1", "int_1": 1.0, "intstring": "1", "roundfloat": 1.0, "roundfloatstring": "1.0", "name": "test", "time1": constantTime, "time2": timestamp.MustParseTime(time.RFC3339Nano, "2022-08-18T14:17:22.375Z"), "date1": "2022-08-18", "arr1": "[]", "arr2": "[1,2,3]", "arr3": "[\"a\",\"b\",\"c\"]"},
			},
			configIds: allBulkerConfigs,
		},
		//{
		//	name:              "types2",
		//	modes:             []bulker.BulkMode{bulker.Batch, bulker.Stream, bulker.ReplaceTable, bulker.ReplacePartition},
		//	expectPartitionId: true,
		//	dataFile:          "test_data/types2.ndjson",
		//	expectedTable: ExpectedTable{
		//		Columns: justColumns("id", "bool1", "bool2", "boolstring", "float1", "floatstring", "int_1", "intstring", "roundfloat", "roundfloatstring", "name", "time1", "time2", "date1"),
		//	},
		//	expectedRows: []map[string]any{
		//		{"id": 1, "bool1": false, "bool2": true, "boolstring": "false", "float1": 1.0, "floatstring": "1.0", "int_1": 1, "intstring": "1", "roundfloat": 1.0, "roundfloatstring": "1.0", "name": "test", "time1": constantTime, "time2": timestamp.MustParseTime(time.RFC3339Nano, "2022-08-18T14:17:22.375Z"), "date1": "2022-08-18"},
		//		{"id": 2, "bool1": false, "bool2": true, "boolstring": "true", "float1": 1.2, "floatstring": "1.1", "int_1": 1, "intstring": "1", "roundfloat": 1.0, "roundfloatstring": "1.0", "name": "test", "time1": constantTime, "time2": timestamp.MustParseTime(time.RFC3339Nano, "2022-08-18T14:17:22.375Z"), "date1": "2022-08-18"},
		//		{"id": 3, "bool1": false, "bool2": true, "boolstring": "false", "float1": 1.0, "floatstring": "1.0", "int_1": 1, "intstring": "1", "roundfloat": 1.0, "roundfloatstring": "1.0", "name": "test", "time1": constantTime, "time2": timestamp.MustParseTime(time.RFC3339Nano, "2022-08-18T14:17:22.375Z"), "date1": "2022-08-18"},
		//	},
		//	expectedErrors: map[string]any{"create_stream_bigquery_stream": BigQueryAutocommitUnsupported},
		//	configIds:      allBulkerConfigs,
		//},
		{
			name:              "types_collision_stream",
			modes:             []bulker.BulkMode{bulker.Stream},
			expectPartitionId: true,
			dataFile:          "test_data/types_collision.ndjson",
			expectedRows: []map[string]any{
				{"id": 1, "int_1": 1, "roundfloat": 1.0, "float1": 1.2, "intstring": "1", "roundfloatstring": "1.0", "floatstring": "1.1", "string1": "test", "bool1": false, "bool2": true, "time1": constantTime, "time2": constantTime, "time3": "2022-08-18", "_unmapped_data": nil},
				{"id": 2, "int_1": nil, "roundfloat": 1.0, "float1": 1.0, "intstring": "1.1", "roundfloatstring": "1.1", "floatstring": "1.0", "string1": "test", "bool1": false, "bool2": true, "time1": constantTime, "time2": constantTime, "time3": "2022-08-18", "_unmapped_data": "{\"int_1\": \"a\"}"},
			},
			configIds: utils.ArrayIntersection(allBulkerConfigs, []string{PostgresBulkerTypeId, MySQLBulkerTypeId}),
		},
		{
			name:              "types_collision_stream",
			modes:             []bulker.BulkMode{bulker.Stream},
			expectPartitionId: true,
			dataFile:          "test_data/types_collision.ndjson",
			expectedRows: []map[string]any{
				{"id": 1, "int_1": 1, "roundfloat": 1.0, "float1": 1.2, "intstring": "1", "roundfloatstring": "1.0", "floatstring": "1.1", "string1": "test", "bool1": false, "bool2": true, "time1": constantTime, "time2": constantTime, "time3": "2022-08-18", "_unmapped_data": nil},
				{"id": 2, "int_1": nil, "roundfloat": 1.0, "float1": 1.0, "intstring": "1.1", "roundfloatstring": "1.1", "floatstring": "1.0", "string1": "test", "bool1": false, "bool2": true, "time1": constantTime, "time2": constantTime, "time3": "2022-08-18", "_unmapped_data": map[string]any{"int_1": "a"}},
			},
			configIds: utils.ArrayIntersection(allBulkerConfigs, []string{DuckDBBulkerTypeId}),
		},
		{
			name:              "types_collision_batch_duckdb",
			modes:             []bulker.BulkMode{bulker.Batch},
			expectPartitionId: true,
			dataFile:          "test_data/types_collision2.ndjson",
			expectedRows: []map[string]any{
				{"id": 1, "string2": "test", "time1": constantTime},
				{"id": 2, "string2": "2022-08-18T14:17:22.375Z", "time1": constantTime},
				{"id": 3, "string2": nil, "time1": constantTime},
			},
			configIds: utils.ArrayIntersection(allBulkerConfigs, []string{DuckDBBulkerTypeId}),
		},
		{
			name:              "types_collision_stream",
			modes:             []bulker.BulkMode{bulker.Stream},
			expectPartitionId: true,
			dataFile:          "test_data/types_collision.ndjson",
			expectedRows: []map[string]any{
				{"id": 1, "int_1": 1, "roundfloat": 1.0, "float1": 1.2, "intstring": "1", "roundfloatstring": "1.0", "floatstring": "1.1", "string1": "test", "bool1": false, "bool2": true, "time1": constantTime, "time2": constantTime, "time3": "2022-08-18", "_unmapped_data": nil},
				{"id": 2, "int_1": 0, "roundfloat": 1.0, "float1": 1.0, "intstring": "1.1", "roundfloatstring": "1.1", "floatstring": "1.0", "string1": "test", "bool1": false, "bool2": true, "time1": constantTime, "time2": constantTime, "time3": "2022-08-18", "_unmapped_data": "{\"int_1\":\"a\"}"},
			},
			configIds: utils.ArrayIntersection(allBulkerConfigs, []string{ClickHouseBulkerTypeId, ClickHouseBulkerTypeId + "_cluster", ClickHouseBulkerTypeId + "_cluster_noshards", ClickHouseBulkerTypeId + "_replicated_db", ClickHouseBulkerTypeId + "_replicated_db_sharded"}),
		},
		{
			name:              "types_collision_stream",
			modes:             []bulker.BulkMode{bulker.Stream},
			expectPartitionId: true,
			dataFile:          "test_data/types_collision.ndjson",
			expectedRows: []map[string]any{
				{"id": 1, "int_1": 1, "roundfloat": 1.0, "float1": 1.2, "intstring": "1", "roundfloatstring": "1.0", "floatstring": "1.1", "string1": "test", "bool1": false, "bool2": true, "time1": constantTime, "time2": constantTime, "time3": "2022-08-18", "_unmapped_data": nil},
				{"id": 2, "int_1": nil, "roundfloat": 1.0, "float1": 1.0, "intstring": "1.1", "roundfloatstring": "1.1", "floatstring": "1.0", "string1": "test", "bool1": false, "bool2": true, "time1": constantTime, "time2": constantTime, "time3": "2022-08-18", "_unmapped_data": "{\"int_1\":\"a\"}"},
			},
			configIds: utils.ArrayIntersection(allBulkerConfigs, []string{RedshiftBulkerTypeId, RedshiftBulkerTypeId + "_serverless", RedshiftBulkerTypeId + "_iam"}),
		},
		{
			name:              "types_collision_stream",
			modes:             []bulker.BulkMode{bulker.Stream},
			expectPartitionId: true,
			dataFile:          "test_data/types_collision.ndjson",
			expectedRows: []map[string]any{
				{"id": 1, "int_1": 1, "roundfloat": 1.0, "float1": 1.2, "intstring": "1", "roundfloatstring": "1.0", "floatstring": "1.1", "string1": "test", "bool1": false, "bool2": true, "time1": constantTime, "time2": constantTime, "time3": "2022-08-18", "_unmapped_data": nil},
				{"id": 2, "int_1": nil, "roundfloat": 1.0, "float1": 1.0, "intstring": "1.1", "roundfloatstring": "1.1", "floatstring": "1.0", "string1": "test", "bool1": false, "bool2": true, "time1": constantTime, "time2": constantTime, "time3": "2022-08-18", "_unmapped_data": "{\"INT_1\":\"a\"}"},
			},
			configIds: utils.ArrayIntersection(allBulkerConfigs, []string{SnowflakeBulkerTypeId}),
		},
		{
			//for batch modes bulker accumulates common type for int_1 column before sending batch. and common type is String
			name:              "types_collision_other",
			modes:             []bulker.BulkMode{bulker.Batch, bulker.ReplaceTable, bulker.ReplacePartition},
			expectPartitionId: true,
			dataFile:          "test_data/types_collision.ndjson",
			expectedRows: []map[string]any{
				{"id": 1, "int_1": "1", "roundfloat": 1.0, "float1": 1.2, "intstring": "1", "roundfloatstring": "1.0", "floatstring": "1.1", "string1": "test", "bool1": false, "bool2": true, "time1": constantTime, "time2": constantTime, "time3": "2022-08-18"},
				{"id": 2, "int_1": "a", "roundfloat": 1.0, "float1": 1.0, "intstring": "1.1", "roundfloatstring": "1.1", "floatstring": "1.0", "string1": "test", "bool1": false, "bool2": true, "time1": constantTime, "time2": constantTime, "time3": "2022-08-18"},
			},
			configIds: allBulkerConfigs,
		},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			runTestConfig(t, tt, testStream)
		})
	}
}

func TestReverseDataTypeMapping(t *testing.T) {
	t.Parallel()
	tests := []bulkerTestConfig{
		{
			name:                      "data_types_from_sql_types",
			modes:                     []bulker.BulkMode{bulker.Batch},
			dataFile:                  "test_data/data_types.ndjson",
			expectedTableTypeChecking: TypeCheckingDataTypesOnly,
			expectedTable: ExpectedTable{
				Columns: NewColumnsFromArrays([]jsonorder.El[string, types2.SQLColumn]{
					{"id", types2.SQLColumn{DataType: types2.INT64}},
					{"float_type", types2.SQLColumn{DataType: types2.FLOAT64}},
					{"time_type", types2.SQLColumn{DataType: types2.TIMESTAMP}},
					{"bool_type", types2.SQLColumn{DataType: types2.BOOL}},
					{"string_type", types2.SQLColumn{DataType: types2.STRING}},
				}),
			},
			configIds: allBulkerConfigs,
		},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			runTestConfig(t, tt, testStream)
		})
	}
}

func TestSQLTypeHints(t *testing.T) {
	t.Parallel()
	tests := []bulkerTestConfig{
		{
			name:                      "sql_types_hints_postgres",
			modes:                     []bulker.BulkMode{bulker.Stream, bulker.Batch},
			expectPartitionId:         true,
			dataFile:                  "test_data/type_hints.ndjson",
			expectedTableTypeChecking: TypeCheckingSQLTypesOnly,
			expectedTable: ExpectedTable{
				Columns: NewColumnsFromArrays([]jsonorder.El[string, types2.SQLColumn]{
					{"id", types2.SQLColumn{Type: "bigint"}},
					{"time1", types2.SQLColumn{Type: "timestamp with time zone"}},
					{"name", types2.SQLColumn{Type: "text"}},
					{"int1", types2.SQLColumn{Type: "bigint"}},
					{"nested_json1", types2.SQLColumn{Type: "json"}},
					{"nested_json2", types2.SQLColumn{Type: "json"}},
					{"nested_json3_a", types2.SQLColumn{Type: "bigint"}},
					{"nested_json3_nested_json_nested", types2.SQLColumn{Type: "json"}},
					{"nested_json4", types2.SQLColumn{Type: "json"}},
				}),
			},
			expectedRows: []map[string]any{
				{"id": 1, "time1": constantTime, "name": "a", "int1": 27, "nested_json1": "{\"a\":1}", "nested_json2": "{\"a\":\"2\"}", "nested_json3_a": 2, "nested_json3_nested_json_nested": "{\"a\":3}", "nested_json4": "{\"a\":\"4\"}"},
			},
			streamOptions: []bulker.StreamOption{WithColumnTypes(types2.SQLTypes{}.
				With("nested_json4", "json"))},
			configIds: utils.ArrayIntersection(allBulkerConfigs, []string{PostgresBulkerTypeId}),
		}, {
			name:                      "sql_types_hints_bigquery",
			modes:                     []bulker.BulkMode{bulker.Batch},
			expectPartitionId:         true,
			dataFile:                  "test_data/type_hints_bq.ndjson",
			expectedTableTypeChecking: TypeCheckingSQLTypesOnly,
			expectedTable: ExpectedTable{
				Columns: NewColumnsFromArrays([]jsonorder.El[string, types2.SQLColumn]{
					{"id", types2.SQLColumn{Type: string(bigquery.IntegerFieldType)}},
					{"time1", types2.SQLColumn{Type: string(bigquery.TimestampFieldType)}},
					{"name", types2.SQLColumn{Type: string(bigquery.StringFieldType)}},
					{"int1", types2.SQLColumn{Type: string(bigquery.IntegerFieldType)}},
					{"nested_json1", types2.SQLColumn{Type: string(bigquery.JSONFieldType)}},
					{"nested_json2", types2.SQLColumn{Type: string(bigquery.JSONFieldType)}},
					{"nested_json3_a", types2.SQLColumn{Type: string(bigquery.IntegerFieldType)}},
					{"nested_json3_nested_json_nested", types2.SQLColumn{Type: string(bigquery.JSONFieldType)}},
					{"nested_json4", types2.SQLColumn{Type: string(bigquery.JSONFieldType)}},
				}),
			},
			expectedRows: []map[string]any{
				{"id": 1, "time1": constantTime, "name": "a", "int1": 27, "nested_json1": "{\"a\":1}", "nested_json2": "{\"a\":\"2\"}", "nested_json3_a": 2, "nested_json3_nested_json_nested": "{\"a\":3}", "nested_json4": "{\"a\":\"4\"}"},
			},
			streamOptions: []bulker.StreamOption{WithColumnTypes(types2.SQLTypes{}.
				With("nested_json4", "json"))},
			configIds: utils.ArrayIntersection(allBulkerConfigs, []string{BigqueryBulkerTypeId}),
		},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			runTestConfig(t, tt, testStream)
		})
	}
}

func TestTypeOverrideOption(t *testing.T) {
	t.Parallel()
	//t.Skip("Temporarily disabled")
	tests := []bulkerTestConfig{
		{
			name:              "types_override_postgres",
			modes:             []bulker.BulkMode{bulker.Batch, bulker.Stream, bulker.ReplaceTable, bulker.ReplacePartition},
			expectPartitionId: true,
			dataFile:          "test_data/types.ndjson",
			expectedTable: ExpectedTable{
				Columns: justColumns("id", "time1", "time2", "date1", "int_1", "roundfloat", "float1", "intstring", "roundfloatstring", "floatstring", "name", "bool1", "bool2", "boolstring", "arr1", "arr2", "arr3"),
			},
			expectedRows: []map[string]any{
				{"id": 1, "bool1": false, "bool2": true, "boolstring": true, "float1": 1.2, "floatstring": 1.1, "int_1": 1, "intstring": 1, "roundfloat": 1.0, "roundfloatstring": 1.0, "name": "test", "time1": constantTime, "time2": timestamp.MustParseTime(time.RFC3339Nano, "2022-08-18T14:17:22.375Z"), "date1": timestamp.MustParseTime("2006-01-02", "2022-08-18"), "arr1": "[]", "arr2": "[1,2,3]", "arr3": "[\"a\",\"b\",\"c\"]"},
				{"id": 2, "bool1": false, "bool2": true, "boolstring": false, "float1": 1.0, "floatstring": 1.0, "int_1": 1, "intstring": 1, "roundfloat": 1.0, "roundfloatstring": 1.0, "name": "test", "time1": constantTime, "time2": timestamp.MustParseTime(time.RFC3339Nano, "2022-08-18T14:17:22.375Z"), "date1": timestamp.MustParseTime("2006-01-02", "2022-08-18"), "arr1": "[]", "arr2": "[1,2,3]", "arr3": "[\"a\",\"b\",\"c\"]"},
				{"id": 3, "bool1": false, "bool2": true, "boolstring": true, "float1": 1.2, "floatstring": 1.1, "int_1": 1, "intstring": 1, "roundfloat": 1.0, "roundfloatstring": 1.0, "name": "test", "time1": constantTime, "time2": timestamp.MustParseTime(time.RFC3339Nano, "2022-08-18T14:17:22.375Z"), "date1": timestamp.MustParseTime("2006-01-02", "2022-08-18"), "arr1": "[]", "arr2": "[1,2,3]", "arr3": "[\"a\",\"b\",\"c\"]"},
			},
			streamOptions: []bulker.StreamOption{WithColumnTypes(types2.SQLTypes{}.
				With("floatstring", "double precision").
				With("roundfloatstring", "double precision").
				With("boolstring", "boolean").
				With("date1", "date").
				With("int_1", "bigint").
				With("intstring", "bigint"))},
			configIds: utils.ArrayIntersection(allBulkerConfigs, []string{PostgresBulkerTypeId}),
		},
		{
			name:              "types_override_redshift",
			modes:             []bulker.BulkMode{bulker.Batch, bulker.Stream, bulker.ReplaceTable, bulker.ReplacePartition},
			expectPartitionId: true,
			dataFile:          "test_data/types.ndjson",
			expectedTable: ExpectedTable{
				Columns: justColumns("id", "time1", "time2", "date1", "int_1", "roundfloat", "float1", "intstring", "roundfloatstring", "floatstring", "name", "bool1", "bool2", "boolstring", "arr1", "arr2", "arr3"),
			},
			expectedRows: []map[string]any{
				{"id": 1, "bool1": false, "bool2": true, "boolstring": true, "float1": 1.2, "floatstring": 1.1, "int_1": 1, "intstring": 1, "roundfloat": 1.0, "roundfloatstring": 1.0, "name": "test", "time1": constantTime, "time2": timestamp.MustParseTime(time.RFC3339Nano, "2022-08-18T14:17:22.375Z"), "date1": timestamp.MustParseTime("2006-01-02", "2022-08-18"), "arr1": "[]", "arr2": "[1,2,3]", "arr3": "[\"a\",\"b\",\"c\"]"},
				{"id": 2, "bool1": false, "bool2": true, "boolstring": false, "float1": 1.0, "floatstring": 1.0, "int_1": 1, "intstring": 1, "roundfloat": 1.0, "roundfloatstring": 1.0, "name": "test", "time1": constantTime, "time2": timestamp.MustParseTime(time.RFC3339Nano, "2022-08-18T14:17:22.375Z"), "date1": timestamp.MustParseTime("2006-01-02", "2022-08-18"), "arr1": "[]", "arr2": "[1,2,3]", "arr3": "[\"a\",\"b\",\"c\"]"},
				{"id": 3, "bool1": false, "bool2": true, "boolstring": true, "float1": 1.2, "floatstring": 1.1, "int_1": 1, "intstring": 1, "roundfloat": 1.0, "roundfloatstring": 1.0, "name": "test", "time1": constantTime, "time2": timestamp.MustParseTime(time.RFC3339Nano, "2022-08-18T14:17:22.375Z"), "date1": timestamp.MustParseTime("2006-01-02", "2022-08-18"), "arr1": "[]", "arr2": "[1,2,3]", "arr3": "[\"a\",\"b\",\"c\"]"},
			},
			streamOptions: []bulker.StreamOption{WithColumnTypes(types2.SQLTypes{}.
				With("floatstring", "double precision").
				With("roundfloatstring", "double precision").
				With("boolstring", "boolean").
				With("date1", "date").
				With("int_1", "bigint").
				With("intstring", "bigint"))},
			configIds: utils.ArrayIntersection(allBulkerConfigs, []string{RedshiftBulkerTypeId, RedshiftBulkerTypeId + "_serverless", RedshiftBulkerTypeId + "_iam"}),
		},
		{
			name:              "types_override_bigquery",
			modes:             []bulker.BulkMode{bulker.Batch, bulker.Stream, bulker.ReplaceTable, bulker.ReplacePartition},
			expectPartitionId: true,
			dataFile:          "test_data/types.ndjson",
			expectedTable: ExpectedTable{
				Columns: justColumns("id", "time1", "time2", "date1", "int_1", "roundfloat", "float1", "intstring", "roundfloatstring", "floatstring", "name", "bool1", "bool2", "boolstring", "arr1", "arr2", "arr3"),
			},
			expectedRows: []map[string]any{
				{"id": 1, "bool1": false, "bool2": true, "boolstring": true, "float1": 1.2, "floatstring": 1.1, "int_1": 1, "intstring": 1, "roundfloat": 1.0, "roundfloatstring": 1.0, "name": "test", "time1": constantTime, "time2": timestamp.MustParseTime(time.RFC3339Nano, "2022-08-18T14:17:22.375Z"), "date1": timestamp.MustParseTime("2006-01-02", "2022-08-18"), "arr1": "[]", "arr2": "[1,2,3]", "arr3": "[\"a\",\"b\",\"c\"]"},
				{"id": 2, "bool1": false, "bool2": true, "boolstring": false, "float1": 1.0, "floatstring": 1.0, "int_1": 1, "intstring": 1, "roundfloat": 1.0, "roundfloatstring": 1.0, "name": "test", "time1": constantTime, "time2": timestamp.MustParseTime(time.RFC3339Nano, "2022-08-18T14:17:22.375Z"), "date1": timestamp.MustParseTime("2006-01-02", "2022-08-18"), "arr1": "[]", "arr2": "[1,2,3]", "arr3": "[\"a\",\"b\",\"c\"]"},
				{"id": 3, "bool1": false, "bool2": true, "boolstring": true, "float1": 1.2, "floatstring": 1.1, "int_1": 1, "intstring": 1, "roundfloat": 1.0, "roundfloatstring": 1.0, "name": "test", "time1": constantTime, "time2": timestamp.MustParseTime(time.RFC3339Nano, "2022-08-18T14:17:22.375Z"), "date1": timestamp.MustParseTime("2006-01-02", "2022-08-18"), "arr1": "[]", "arr2": "[1,2,3]", "arr3": "[\"a\",\"b\",\"c\"]"},
			},
			streamOptions: []bulker.StreamOption{WithColumnTypes(types2.SQLTypes{}.
				With("floatstring", "FLOAT").
				With("roundfloatstring", "FLOAT").
				With("boolstring", "BOOLEAN").
				With("date1", "DATE").
				With("int_1", "INTEGER").
				With("intstring", "INTEGER"))},
			expectedErrors: map[string]any{"create_stream_bigquery_stream": BigQueryAutocommitUnsupported},
			configIds:      utils.ArrayIntersection(allBulkerConfigs, []string{BigqueryBulkerTypeId}),
		},
		{
			name:              "types_override_snowflake",
			modes:             []bulker.BulkMode{bulker.Batch, bulker.Stream, bulker.ReplaceTable, bulker.ReplacePartition},
			expectPartitionId: true,
			dataFile:          "test_data/types.ndjson",
			expectedTable: ExpectedTable{
				Columns: justColumns("id", "time1", "time2", "date1", "int_1", "roundfloat", "float1", "intstring", "roundfloatstring", "floatstring", "name", "bool1", "bool2", "boolstring", "arr1", "arr2", "arr3"),
			},
			expectedRows: []map[string]any{
				{"id": 1, "bool1": false, "bool2": true, "boolstring": true, "float1": 1.2, "floatstring": 1.1, "int_1": 1, "intstring": 1, "roundfloat": 1.0, "roundfloatstring": 1.0, "name": "test", "time1": constantTime, "time2": timestamp.MustParseTime(time.RFC3339Nano, "2022-08-18T14:17:22.375Z"), "date1": timestamp.MustParseTime("2006-01-02", "2022-08-18"), "arr1": "[]", "arr2": "[1,2,3]", "arr3": "[\"a\",\"b\",\"c\"]"},
				{"id": 2, "bool1": false, "bool2": true, "boolstring": false, "float1": 1.0, "floatstring": 1.0, "int_1": 1, "intstring": 1, "roundfloat": 1.0, "roundfloatstring": 1.0, "name": "test", "time1": constantTime, "time2": timestamp.MustParseTime(time.RFC3339Nano, "2022-08-18T14:17:22.375Z"), "date1": timestamp.MustParseTime("2006-01-02", "2022-08-18"), "arr1": "[]", "arr2": "[1,2,3]", "arr3": "[\"a\",\"b\",\"c\"]"},
				{"id": 3, "bool1": false, "bool2": true, "boolstring": true, "float1": 1.2, "floatstring": 1.1, "int_1": 1, "intstring": 1, "roundfloat": 1.0, "roundfloatstring": 1.0, "name": "test", "time1": constantTime, "time2": timestamp.MustParseTime(time.RFC3339Nano, "2022-08-18T14:17:22.375Z"), "date1": timestamp.MustParseTime("2006-01-02", "2022-08-18"), "arr1": "[]", "arr2": "[1,2,3]", "arr3": "[\"a\",\"b\",\"c\"]"},
			},
			streamOptions: []bulker.StreamOption{WithColumnTypes(types2.SQLTypes{}.
				With("floatstring", "double precision").
				With("roundfloatstring", "double precision").
				With("boolstring", "boolean").
				With("date1", "date").
				With("int_1", "bigint").
				With("intstring", "bigint"))},
			configIds: utils.ArrayIntersection(allBulkerConfigs, []string{SnowflakeBulkerTypeId}),
		},
		{
			name:              "types_override_mysql",
			modes:             []bulker.BulkMode{bulker.Batch, bulker.Stream, bulker.ReplaceTable, bulker.ReplacePartition},
			expectPartitionId: true,
			dataFile:          "test_data/types.ndjson",
			expectedTable: ExpectedTable{
				Columns: justColumns("id", "time1", "time2", "date1", "int_1", "roundfloat", "float1", "intstring", "roundfloatstring", "floatstring", "name", "bool1", "bool2", "boolstring", "arr1", "arr2", "arr3"),
			},
			expectedRows: []map[string]any{
				{"id": 1, "bool1": false, "bool2": true, "boolstring": "true", "float1": 1.2, "floatstring": 1.1, "int_1": 1, "intstring": 1, "roundfloat": 1.0, "roundfloatstring": 1.0, "name": "test", "time1": constantTime, "time2": timestamp.MustParseTime(time.RFC3339Nano, "2022-08-18T14:17:22.375Z"), "date1": timestamp.MustParseTime("2006-01-02", "2022-08-18"), "arr1": "[]", "arr2": "[1,2,3]", "arr3": "[\"a\",\"b\",\"c\"]"},
				{"id": 2, "bool1": false, "bool2": true, "boolstring": "false", "float1": 1.0, "floatstring": 1.0, "int_1": 1, "intstring": 1, "roundfloat": 1.0, "roundfloatstring": 1.0, "name": "test", "time1": constantTime, "time2": timestamp.MustParseTime(time.RFC3339Nano, "2022-08-18T14:17:22.375Z"), "date1": timestamp.MustParseTime("2006-01-02", "2022-08-18"), "arr1": "[]", "arr2": "[1,2,3]", "arr3": "[\"a\",\"b\",\"c\"]"},
				{"id": 3, "bool1": false, "bool2": true, "boolstring": "true", "float1": 1.2, "floatstring": 1.1, "int_1": 1, "intstring": 1, "roundfloat": 1.0, "roundfloatstring": 1.0, "name": "test", "time1": constantTime, "time2": timestamp.MustParseTime(time.RFC3339Nano, "2022-08-18T14:17:22.375Z"), "date1": timestamp.MustParseTime("2006-01-02", "2022-08-18"), "arr1": "[]", "arr2": "[1,2,3]", "arr3": "[\"a\",\"b\",\"c\"]"},
			},
			streamOptions: []bulker.StreamOption{WithColumnTypes(types2.SQLTypes{}.
				With("floatstring", "DOUBLE").
				With("roundfloatstring", "DOUBLE").
				//With("boolstring", "boolean"). //mysql doesnt cast 'true','false' string to boolean
				With("date1", "date").
				With("int_1", "BIGINT").
				With("intstring", "BIGINT"))},
			configIds: utils.ArrayIntersection(allBulkerConfigs, []string{MySQLBulkerTypeId}),
		},
		{
			name:              "types_override_clickhouse",
			modes:             []bulker.BulkMode{bulker.Batch, bulker.Stream, bulker.ReplaceTable, bulker.ReplacePartition},
			expectPartitionId: true,
			dataFile:          "test_data/types.ndjson",
			expectedTable: ExpectedTable{
				Columns: justColumns("id", "time1", "time2", "date1", "int_1", "roundfloat", "float1", "intstring", "roundfloatstring", "floatstring", "name", "bool1", "bool2", "boolstring", "arr1", "arr2", "arr3"),
			},
			expectedRows: []map[string]any{
				{"id": 1, "bool1": false, "bool2": true, "boolstring": true, "float1": 1.2, "floatstring": 1.1, "int_1": 1, "intstring": 1, "roundfloat": 1.0, "roundfloatstring": 1.0, "name": "test", "time1": constantTime, "time2": timestamp.MustParseTime(time.RFC3339Nano, "2022-08-18T14:17:22.375Z"), "date1": timestamp.MustParseTime("2006-01-02", "2022-08-18"), "arr1": "[]", "arr2": "[1,2,3]", "arr3": "[\"a\",\"b\",\"c\"]"},
				{"id": 2, "bool1": false, "bool2": true, "boolstring": false, "float1": 1.0, "floatstring": 1.0, "int_1": 1, "intstring": 1, "roundfloat": 1.0, "roundfloatstring": 1.0, "name": "test", "time1": constantTime, "time2": timestamp.MustParseTime(time.RFC3339Nano, "2022-08-18T14:17:22.375Z"), "date1": timestamp.MustParseTime("2006-01-02", "2022-08-18"), "arr1": "[]", "arr2": "[1,2,3]", "arr3": "[\"a\",\"b\",\"c\"]"},
				{"id": 3, "bool1": false, "bool2": true, "boolstring": true, "float1": 1.2, "floatstring": 1.1, "int_1": 1, "intstring": 1, "roundfloat": 1.0, "roundfloatstring": 1.0, "name": "test", "time1": constantTime, "time2": timestamp.MustParseTime(time.RFC3339Nano, "2022-08-18T14:17:22.375Z"), "date1": timestamp.MustParseTime("2006-01-02", "2022-08-18"), "arr1": "[]", "arr2": "[1,2,3]", "arr3": "[\"a\",\"b\",\"c\"]"},
			},
			streamOptions: []bulker.StreamOption{WithColumnTypes(types2.SQLTypes{}.
				With("floatstring", "Float64").
				With("roundfloatstring", "Float64").
				With("boolstring", "bool").
				With("date1", "Date").
				With("int_1", "Int64").
				With("intstring", "Int64"))},
			configIds: utils.ArrayIntersection(allBulkerConfigs, []string{ClickHouseBulkerTypeId, ClickHouseBulkerTypeId + "_cluster_noshards", ClickHouseBulkerTypeId + "_replicated_db", ClickHouseBulkerTypeId + "_replicated_db_sharded"}),
		},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			runTestConfig(t, tt, testStream)
		})
	}
}

func TestTypeCoalesce(t *testing.T) {
	t.Parallel()
	tests := []bulkerTestConfig{
		{
			// this test runs in 2 batches by 4 rows
			// first batch makes sure that table is created with correct types of columns (least common type of types collected from 4 first rows)
			// second batch makes sure that new data is properly converted to column types where applicable
			name:                      "type_coalesce",
			modes:                     []bulker.BulkMode{bulker.Batch},
			dataFile:                  "test_data/types_coalesce.ndjson",
			expectedTableTypeChecking: TypeCheckingDataTypesOnly,
			batchSize:                 4,
			expectedTable: ExpectedTable{
				Columns: NewColumnsFromArrays([]jsonorder.El[string, types2.SQLColumn]{
					{"id", types2.SQLColumn{DataType: types2.INT64}},
					{"str_1", types2.SQLColumn{DataType: types2.STRING}},
					{"float_1", types2.SQLColumn{DataType: types2.FLOAT64}},
					{"int_1", types2.SQLColumn{DataType: types2.INT64}},
					{"bool_1", types2.SQLColumn{DataType: types2.BOOL}},
					{"str_2", types2.SQLColumn{DataType: types2.STRING}},
				}),
			},
			expectedRows: []map[string]any{
				{"id": 1, "str_1": "7", "float_1": 7.0, "int_1": 7, "bool_1": true, "str_2": "str"},
				{"id": 2, "str_1": "7", "float_1": 7.0, "int_1": 7, "bool_1": false, "str_2": "str"},
				{"id": 3, "str_1": "3.14", "float_1": 3.14, "int_1": 7, "bool_1": true, "str_2": "str"},
				{"id": 4, "str_1": "str", "float_1": 3.14, "int_1": 7, "bool_1": true, "str_2": "str"},
				{"id": 5, "str_1": "str", "float_1": 1.0, "int_1": 9, "bool_1": false, "str_2": "str"},
				{"id": 6, "str_1": "str", "float_1": 0.0, "int_1": 0, "bool_1": true, "str_2": "str"},
				{"id": 7, "str_1": "str", "float_1": 7.0, "int_1": 1, "bool_1": true, "str_2": "str"},
				{"id": 8, "str_1": "str", "float_1": 7.0, "int_1": 1, "bool_1": false, "str_2": "str"},
			},
			configIds: allBulkerConfigs,
		},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			runTestConfig(t, tt, testStream)
		})
	}
}

func TestJSONTypes(t *testing.T) {
	t.Parallel()
	tests := []bulkerTestConfig{
		{
			name:                      "json_test_postgres",
			modes:                     []bulker.BulkMode{bulker.Stream, bulker.Batch, bulker.ReplaceTable, bulker.ReplacePartition},
			expectPartitionId:         true,
			dataFile:                  "test_data/types_json.ndjson",
			expectedTableTypeChecking: TypeCheckingSQLTypesOnly,
			expectedTable: ExpectedTable{
				Columns: NewColumnsFromArrays([]jsonorder.El[string, types2.SQLColumn]{
					{"_timestamp", types2.SQLColumn{Type: "timestamp with time zone"}},
					{"id", types2.SQLColumn{Type: "bigint"}},
					{"name", types2.SQLColumn{Type: "text"}},
					{"json1_nested", types2.SQLColumn{Type: "bigint"}},
					{"json2", types2.SQLColumn{Type: "jsonb"}},
					{"array1", types2.SQLColumn{Type: "jsonb"}},
					{"json1_nested2_nested", types2.SQLColumn{Type: "bigint"}},
				}),
			},
			expectedRows: []map[string]any{
				{"_timestamp": constantTime, "id": 1, "name": "a", "json1_nested": 1, "json2": "{\"nested\": 1}", "array1": "[\"1\", \"2\", \"3\"]", "json1_nested2_nested": nil},
				{"_timestamp": constantTime, "id": 2, "name": "b", "json1_nested": nil, "json2": "{\"nested\": {\"nested\": 2}}", "array1": "[1, 2, 3]", "json1_nested2_nested": 2},
				{"_timestamp": constantTime, "id": 3, "name": "c", "json1_nested": 1, "json2": "{\"nested\": 1}", "array1": "[{\"nested\": 1}, {\"nested\": 2}, {\"nested\": 3}]", "json1_nested2_nested": nil},
			},
			streamOptions: []bulker.StreamOption{bulker.WithSchema(types2.Schema{
				Name: "d",
				Fields: []types2.SchemaField{
					{Name: "_timestamp", Type: types2.TIMESTAMP},
					{Name: "id", Type: types2.INT64},
					{Name: "name", Type: types2.STRING},
					{Name: "json1_nested", Type: types2.INT64},
					{Name: "json2", Type: types2.JSON},
					{Name: "array1", Type: types2.JSON},
					{Name: "json1_nested2_nested", Type: types2.INT64},
				},
			})},
			configIds: utils.ArrayIntersection(allBulkerConfigs, []string{PostgresBulkerTypeId}),
		},
		{
			name:                      "json_test_mysql",
			modes:                     []bulker.BulkMode{bulker.Stream, bulker.Batch, bulker.ReplaceTable, bulker.ReplacePartition},
			expectPartitionId:         true,
			dataFile:                  "test_data/types_json.ndjson",
			expectedTableTypeChecking: TypeCheckingSQLTypesOnly,
			expectedTable: ExpectedTable{
				Columns: NewColumnsFromArrays([]jsonorder.El[string, types2.SQLColumn]{
					{"_timestamp", types2.SQLColumn{Type: "timestamp(6)"}},
					{"id", types2.SQLColumn{Type: "bigint"}},
					{"name", types2.SQLColumn{Type: "text"}},
					{"json1_nested", types2.SQLColumn{Type: "bigint"}},
					{"json2", types2.SQLColumn{Type: "json"}},
					{"array1", types2.SQLColumn{Type: "json"}},
					{"json1_nested2_nested", types2.SQLColumn{Type: "bigint"}},
				}),
			},
			expectedRows: []map[string]any{
				{"_timestamp": constantTime, "id": 1, "name": "a", "json1_nested": 1, "json2": "{\"nested\": 1}", "array1": "[\"1\", \"2\", \"3\"]", "json1_nested2_nested": nil},
				{"_timestamp": constantTime, "id": 2, "name": "b", "json1_nested": nil, "json2": "{\"nested\": {\"nested\": 2}}", "array1": "[1, 2, 3]", "json1_nested2_nested": 2},
				{"_timestamp": constantTime, "id": 3, "name": "c", "json1_nested": 1, "json2": "{\"nested\": 1}", "array1": "[{\"nested\": 1}, {\"nested\": 2}, {\"nested\": 3}]", "json1_nested2_nested": nil},
			},
			streamOptions: []bulker.StreamOption{bulker.WithSchema(types2.Schema{
				Name: "d",
				Fields: []types2.SchemaField{
					{Name: "_timestamp", Type: types2.TIMESTAMP},
					{Name: "id", Type: types2.INT64},
					{Name: "name", Type: types2.STRING},
					{Name: "json1_nested", Type: types2.INT64},
					{Name: "json2", Type: types2.JSON},
					{Name: "array1", Type: types2.JSON},
					{Name: "json1_nested2_nested", Type: types2.INT64},
				},
			})},
			configIds: utils.ArrayIntersection(allBulkerConfigs, []string{MySQLBulkerTypeId}),
		},
		{
			name:                      "json_test_redshift",
			modes:                     []bulker.BulkMode{bulker.Stream, bulker.Batch, bulker.ReplaceTable, bulker.ReplacePartition},
			expectPartitionId:         true,
			dataFile:                  "test_data/types_json.ndjson",
			expectedTableTypeChecking: TypeCheckingSQLTypesOnly,
			expectedTable: ExpectedTable{
				Columns: NewColumnsFromArrays([]jsonorder.El[string, types2.SQLColumn]{
					{"_timestamp", types2.SQLColumn{Type: "timestamp with time zone"}},
					{"id", types2.SQLColumn{Type: "bigint"}},
					{"name", types2.SQLColumn{Type: "character varying(65535)"}},
					{"json1_nested", types2.SQLColumn{Type: "bigint"}},
					{"json2", types2.SQLColumn{Type: "super"}},
					{"array1", types2.SQLColumn{Type: "super"}},
					{"json1_nested2_nested", types2.SQLColumn{Type: "bigint"}},
				}),
			},
			expectedRows: []map[string]any{
				{"_timestamp": constantTime, "id": 1, "name": "a", "json1_nested": 1, "json2": "{\"nested\":1}", "array1": "[\"1\",\"2\",\"3\"]", "json1_nested2_nested": nil},
				{"_timestamp": constantTime, "id": 2, "name": "b", "json1_nested": nil, "json2": "{\"nested\":{\"nested\":2}}", "array1": "[1,2,3]", "json1_nested2_nested": 2},
				{"_timestamp": constantTime, "id": 3, "name": "c", "json1_nested": 1, "json2": "{\"nested\":1}", "array1": "[{\"nested\":1},{\"nested\":2},{\"nested\":3}]", "json1_nested2_nested": nil},
			},
			streamOptions: []bulker.StreamOption{bulker.WithSchema(types2.Schema{
				Name: "d",
				Fields: []types2.SchemaField{
					{Name: "_timestamp", Type: types2.TIMESTAMP},
					{Name: "id", Type: types2.INT64},
					{Name: "name", Type: types2.STRING},
					{Name: "json1_nested", Type: types2.INT64},
					{Name: "json2", Type: types2.JSON},
					{Name: "array1", Type: types2.JSON},
					{Name: "json1_nested2_nested", Type: types2.INT64},
				},
			})},
			configIds: utils.ArrayIntersection(allBulkerConfigs, []string{RedshiftBulkerTypeId, RedshiftBulkerTypeId + "_serverless", RedshiftBulkerTypeId + "_iam"}),
		},
		{
			name:                      "json_test_clickhouse_string",
			modes:                     []bulker.BulkMode{bulker.Stream, bulker.Batch, bulker.ReplaceTable, bulker.ReplacePartition},
			expectPartitionId:         true,
			dataFile:                  "test_data/types_json.ndjson",
			expectedTableTypeChecking: TypeCheckingSQLTypesOnly,
			expectedTable: ExpectedTable{
				Columns: NewColumnsFromArrays([]jsonorder.El[string, types2.SQLColumn]{
					{"_timestamp", types2.SQLColumn{Type: "DateTime64(6)"}},
					{"id", types2.SQLColumn{Type: "Int64"}},
					{"name", types2.SQLColumn{Type: "String"}},
					{"json1_nested", types2.SQLColumn{Type: "Int64"}},
					{"json2", types2.SQLColumn{Type: "String"}},
					{"array1", types2.SQLColumn{Type: "String"}},
					{"json1_nested2_nested", types2.SQLColumn{Type: "Int64"}},
				}),
			},
			expectedRows: []map[string]any{
				{"_timestamp": constantTime, "id": 1, "name": "a", "json1_nested": 1, "json2": "{\"nested\":1}", "array1": "[\"1\",\"2\",\"3\"]", "json1_nested2_nested": 0},
				{"_timestamp": constantTime, "id": 2, "name": "b", "json1_nested": 0, "json2": "{\"nested\":{\"nested\":2}}", "array1": "[1,2,3]", "json1_nested2_nested": 2},
				{"_timestamp": constantTime, "id": 3, "name": "c", "json1_nested": 1, "json2": "{\"nested\":1}", "array1": "[{\"nested\":1},{\"nested\":2},{\"nested\":3}]", "json1_nested2_nested": 0},
			},
			streamOptions: []bulker.StreamOption{bulker.WithSchema(types2.Schema{
				Name: "d",
				Fields: []types2.SchemaField{
					{Name: "_timestamp", Type: types2.TIMESTAMP},
					{Name: "id", Type: types2.INT64},
					{Name: "name", Type: types2.STRING},
					{Name: "json1_nested", Type: types2.INT64},
					{Name: "json2", Type: types2.JSON},
					{Name: "array1", Type: types2.JSON},
					{Name: "json1_nested2_nested", Type: types2.INT64},
				},
			})},
			configIds: utils.ArrayIntersection(allBulkerConfigs, []string{ClickHouseBulkerTypeId + "_cluster", ClickHouseBulkerTypeId + "_replicated_db", ClickHouseBulkerTypeId + "_replicated_db_sharded"}),
		},
		{
			name:                      "json_test_clickhouse_json",
			modes:                     []bulker.BulkMode{bulker.Batch, bulker.ReplaceTable, bulker.ReplacePartition},
			expectPartitionId:         true,
			dataFile:                  "test_data/types_json.ndjson",
			expectedTableTypeChecking: TypeCheckingSQLTypesOnly,
			expectedTable: ExpectedTable{
				Columns: NewColumnsFromArrays([]jsonorder.El[string, types2.SQLColumn]{
					{"_timestamp", types2.SQLColumn{Type: "DateTime64(6)"}},
					{"id", types2.SQLColumn{Type: "Int64"}},
					{"name", types2.SQLColumn{Type: "String"}},
					{"json1_nested", types2.SQLColumn{Type: "Int64"}},
					{"json2", types2.SQLColumn{Type: "JSON"}},
					{"array1", types2.SQLColumn{Type: "String"}},
					{"json1_nested2_nested", types2.SQLColumn{Type: "Int64"}},
				}),
			},
			expectedRows: []map[string]any{
				{"_timestamp": constantTime, "id": 1, "name": "a", "json1_nested": 1, "json2": "{\"nested\":1}", "array1": "[\"1\",\"2\",\"3\"]", "json1_nested2_nested": 0},
				{"_timestamp": constantTime, "id": 2, "name": "b", "json1_nested": 0, "json2": "{\"nested\":{\"nested\":2}}", "array1": "[1,2,3]", "json1_nested2_nested": 2},
				{"_timestamp": constantTime, "id": 3, "name": "c", "json1_nested": 1, "json2": "{\"nested\":1}", "array1": "[{\"nested\":1},{\"nested\":2},{\"nested\":3}]", "json1_nested2_nested": 0},
			},
			streamOptions: []bulker.StreamOption{bulker.WithSchema(types2.Schema{
				Name: "d",
				Fields: []types2.SchemaField{
					{Name: "_timestamp", Type: types2.TIMESTAMP},
					{Name: "id", Type: types2.INT64},
					{Name: "name", Type: types2.STRING},
					{Name: "json1_nested", Type: types2.INT64},
					{Name: "json2", Type: types2.JSON},
					{Name: "array1", Type: types2.STRING},
					{Name: "json1_nested2_nested", Type: types2.INT64},
				},
			})},
			configIds: utils.ArrayIntersection(allBulkerConfigs, []string{ClickHouseBulkerTypeId, ClickHouseBulkerTypeId + "_cluster_noshards"}),
		},
		{
			name:                      "json_test_snowflake",
			modes:                     []bulker.BulkMode{bulker.Stream, bulker.Batch, bulker.ReplaceTable, bulker.ReplacePartition},
			expectPartitionId:         true,
			dataFile:                  "test_data/types_json.ndjson",
			expectedTableTypeChecking: TypeCheckingSQLTypesOnly,
			expectedTable: ExpectedTable{
				Columns: NewColumnsFromArrays([]jsonorder.El[string, types2.SQLColumn]{
					{"_timestamp", types2.SQLColumn{Type: "TIMESTAMP_TZ(6)"}},
					{"id", types2.SQLColumn{Type: "NUMBER(38,0)"}},
					{"name", types2.SQLColumn{Type: "VARCHAR(16777216)"}},
					{"json1_nested", types2.SQLColumn{Type: "NUMBER(38,0)"}},
					{"json2", types2.SQLColumn{Type: "VARCHAR(16777216)"}},
					{"array1", types2.SQLColumn{Type: "VARCHAR(16777216)"}},
					{"json1_nested2_nested", types2.SQLColumn{Type: "NUMBER(38,0)"}},
				}),
			},
			expectedRows: []map[string]any{
				{"_timestamp": constantTime, "id": 1, "name": "a", "json1_nested": 1, "json2": "{\"nested\":1}", "array1": "[\"1\",\"2\",\"3\"]", "json1_nested2_nested": nil},
				{"_timestamp": constantTime, "id": 2, "name": "b", "json1_nested": nil, "json2": "{\"nested\":{\"nested\":2}}", "array1": "[1,2,3]", "json1_nested2_nested": 2},
				{"_timestamp": constantTime, "id": 3, "name": "c", "json1_nested": 1, "json2": "{\"nested\":1}", "array1": "[{\"nested\":1},{\"nested\":2},{\"nested\":3}]", "json1_nested2_nested": nil},
			},
			streamOptions: []bulker.StreamOption{bulker.WithSchema(types2.Schema{
				Name: "d",
				Fields: []types2.SchemaField{
					{Name: "_timestamp", Type: types2.TIMESTAMP},
					{Name: "id", Type: types2.INT64},
					{Name: "name", Type: types2.STRING},
					{Name: "json1_nested", Type: types2.INT64},
					{Name: "json2", Type: types2.JSON},
					{Name: "array1", Type: types2.JSON},
					{Name: "json1_nested2_nested", Type: types2.INT64},
				},
			})},
			configIds: utils.ArrayIntersection(allBulkerConfigs, []string{SnowflakeBulkerTypeId}),
		},
		{
			name:                      "json_test_bigquery",
			modes:                     []bulker.BulkMode{bulker.Batch, bulker.ReplaceTable, bulker.ReplacePartition},
			expectPartitionId:         true,
			dataFile:                  "test_data/types_json.ndjson",
			expectedTableTypeChecking: TypeCheckingSQLTypesOnly,
			expectedTable: ExpectedTable{
				Columns: NewColumnsFromArrays([]jsonorder.El[string, types2.SQLColumn]{
					{"_timestamp", types2.SQLColumn{Type: "TIMESTAMP"}},
					{"id", types2.SQLColumn{Type: "INTEGER"}},
					{"name", types2.SQLColumn{Type: "STRING"}},
					{"json1_nested", types2.SQLColumn{Type: "INTEGER"}},
					{"json2", types2.SQLColumn{Type: "JSON"}},
					{"array1", types2.SQLColumn{Type: "JSON"}},
					{"json1_nested2_nested", types2.SQLColumn{Type: "INTEGER"}},
				}),
			},
			expectedRows: []map[string]any{
				{"_timestamp": constantTime, "id": 1, "name": "a", "json1_nested": 1, "json2": "{\"nested\":1}", "array1": "[\"1\",\"2\",\"3\"]", "json1_nested2_nested": nil},
				{"_timestamp": constantTime, "id": 2, "name": "b", "json1_nested": nil, "json2": "{\"nested\":{\"nested\":2}}", "array1": "[1,2,3]", "json1_nested2_nested": 2},
				{"_timestamp": constantTime, "id": 3, "name": "c", "json1_nested": 1, "json2": "{\"nested\":1}", "array1": "[{\"nested\":1},{\"nested\":2},{\"nested\":3}]", "json1_nested2_nested": nil},
			},
			streamOptions: []bulker.StreamOption{bulker.WithSchema(types2.Schema{
				Name: "d",
				Fields: []types2.SchemaField{
					{Name: "_timestamp", Type: types2.TIMESTAMP},
					{Name: "id", Type: types2.INT64},
					{Name: "name", Type: types2.STRING},
					{Name: "json1_nested", Type: types2.INT64},
					{Name: "json2", Type: types2.JSON},
					{Name: "array1", Type: types2.JSON},
					{Name: "json1_nested2_nested", Type: types2.INT64},
				},
			})},
			configIds: utils.ArrayIntersection(allBulkerConfigs, []string{BigqueryBulkerTypeId}),
		},
		{
			name:                      "json_testduckdb",
			modes:                     []bulker.BulkMode{bulker.Stream, bulker.Batch, bulker.ReplaceTable, bulker.ReplacePartition},
			expectPartitionId:         true,
			dataFile:                  "test_data/types_json.ndjson",
			expectedTableTypeChecking: TypeCheckingSQLTypesOnly,
			expectedTable: ExpectedTable{
				Columns: NewColumnsFromArrays([]jsonorder.El[string, types2.SQLColumn]{
					{"_timestamp", types2.SQLColumn{Type: "timestamp with time zone"}},
					{"id", types2.SQLColumn{Type: "bigint"}},
					{"name", types2.SQLColumn{Type: "varchar"}},
					{"json1_nested", types2.SQLColumn{Type: "bigint"}},
					{"json2", types2.SQLColumn{Type: "json"}},
					{"array1", types2.SQLColumn{Type: "json"}},
					{"json1_nested2_nested", types2.SQLColumn{Type: "bigint"}},
				}),
			},
			expectedRows: []map[string]any{
				{"_timestamp": constantTime, "id": 1, "name": "a", "json1_nested": 1, "json2": map[string]any{"nested": 1.0}, "array1": []any{"1", "2", "3"}, "json1_nested2_nested": nil},
				{"_timestamp": constantTime, "id": 2, "name": "b", "json1_nested": nil, "json2": map[string]any{"nested": map[string]any{"nested": 2.0}}, "array1": []any{1.0, 2.0, 3.0}, "json1_nested2_nested": 2},
				{"_timestamp": constantTime, "id": 3, "name": "c", "json1_nested": 1, "json2": map[string]any{"nested": 1.0}, "array1": []any{map[string]any{"nested": 1.0}, map[string]any{"nested": 2.0}, map[string]any{"nested": 3.0}}, "json1_nested2_nested": nil},
			},
			streamOptions: []bulker.StreamOption{bulker.WithSchema(types2.Schema{
				Name: "d",
				Fields: []types2.SchemaField{
					{Name: "_timestamp", Type: types2.TIMESTAMP},
					{Name: "id", Type: types2.INT64},
					{Name: "name", Type: types2.STRING},
					{Name: "json1_nested", Type: types2.INT64},
					{Name: "json2", Type: types2.JSON},
					{Name: "array1", Type: types2.JSON},
					{Name: "json1_nested2_nested", Type: types2.INT64},
				},
			})},
			configIds: utils.ArrayIntersection(allBulkerConfigs, []string{DuckDBBulkerTypeId}),
		},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			runTestConfig(t, tt, testStream)
		})
	}
}

func TestTransactionalJSON(t *testing.T) {
	t.Parallel()
	tests := []bulkerTestConfig{
		{
			//deletes any table leftovers from previous tests
			name:      "dummy_test_table_cleanup",
			tableName: "transactional_json_test",
			modes:     []bulker.BulkMode{bulker.Batch},
			dataFile:  "test_data/empty.ndjson",
			configIds: utils.ArrayExcluding(allBulkerConfigs, ClickHouseBulkerTypeId, ClickHouseBulkerTypeId+"_cluster_noshards"),
		},
		{
			name:                "added_columns_first_run",
			tableName:           "transactional_json_test",
			modes:               []bulker.BulkMode{bulker.Batch},
			leaveResultingTable: true,
			dataFile:            "test_data/types_json_part1.ndjson",
			expectedTable: ExpectedTable{
				Columns: justColumns("_timestamp", "id", "name", "json1", "array1"),
			},
			expectedRowsCount: 2,
			streamOptions: []bulker.StreamOption{bulker.WithSchema(types2.Schema{
				Name: "d",
				Fields: []types2.SchemaField{
					{Name: "_timestamp", Type: types2.TIMESTAMP},
					{Name: "id", Type: types2.INT64},
					{Name: "name", Type: types2.STRING},
					{Name: "json1", Type: types2.JSON},
					{Name: "array1", Type: types2.JSON},
				},
			})},
			configIds: utils.ArrayExcluding(allBulkerConfigs, ClickHouseBulkerTypeId, ClickHouseBulkerTypeId+"_cluster_noshards"),
		},
		{
			name:                "added_columns_second_run",
			tableName:           "transactional_json_test",
			modes:               []bulker.BulkMode{bulker.Batch},
			leaveResultingTable: true,
			dataFile:            "test_data/types_json_part2.ndjson",
			expectedTable: ExpectedTable{
				Columns: justColumns("_timestamp", "id", "name", "json1", "array1"),
			},
			expectedRowsCount: 4,
			streamOptions: []bulker.StreamOption{bulker.WithSchema(types2.Schema{
				Name: "d",
				Fields: []types2.SchemaField{
					{Name: "_timestamp", Type: types2.TIMESTAMP},
					{Name: "id", Type: types2.INT64},
					{Name: "name", Type: types2.STRING},
					{Name: "json1", Type: types2.JSON},
					{Name: "array1", Type: types2.JSON},
				},
			})},
			configIds: utils.ArrayExcluding(allBulkerConfigs, ClickHouseBulkerTypeId, ClickHouseBulkerTypeId+"_cluster_noshards"),
		},
		{
			name:      "dummy_test_table_cleanup",
			tableName: "transactional_json_test",
			modes:     []bulker.BulkMode{bulker.Batch},
			dataFile:  "test_data/empty.ndjson",
			configIds: utils.ArrayExcluding(allBulkerConfigs, ClickHouseBulkerTypeId, ClickHouseBulkerTypeId+"_cluster_noshards"),
		},
	}
	sequentialGroup := sync.WaitGroup{}
	sequentialGroup.Add(1)
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			runTestConfig(t, tt, testStream)
			sequentialGroup.Done()
		})
		sequentialGroup.Wait()
		sequentialGroup.Add(1)
	}
}

func TestTransactionalJSONnString(t *testing.T) {
	t.Parallel()
	tests := []bulkerTestConfig{
		{
			//deletes any table leftovers from previous tests
			name:      "dummy_test_table_cleanup",
			tableName: "transactional_json_string_test",
			modes:     []bulker.BulkMode{bulker.Batch},
			dataFile:  "test_data/empty.ndjson",
			// TODO: BQ currently doesn't support enforcing STRING type for objects
			configIds: utils.ArrayExcluding(allBulkerConfigs, BigqueryBulkerTypeId),
		},
		{
			name:                "added_columns_first_run",
			tableName:           "transactional_json_string_test",
			modes:               []bulker.BulkMode{bulker.Batch},
			leaveResultingTable: true,
			dataFile:            "test_data/types_json_part1.ndjson",
			expectedTable: ExpectedTable{
				Columns: justColumns("_timestamp", "id", "name", "json1", "array1"),
			},
			expectedRowsCount: 2,
			streamOptions: []bulker.StreamOption{bulker.WithSchema(types2.Schema{
				Name: "d",
				Fields: []types2.SchemaField{
					{Name: "_timestamp", Type: types2.TIMESTAMP},
					{Name: "id", Type: types2.INT64},
					{Name: "name", Type: types2.STRING},
					{Name: "json1", Type: types2.STRING},
					{Name: "array1", Type: types2.STRING},
				},
			})},
			configIds: utils.ArrayExcluding(allBulkerConfigs, BigqueryBulkerTypeId),
		},
		{
			name:                "added_columns_second_run",
			tableName:           "transactional_json_string_test",
			modes:               []bulker.BulkMode{bulker.Batch},
			leaveResultingTable: true,
			dataFile:            "test_data/types_json_part2.ndjson",
			expectedTable: ExpectedTable{
				Columns: justColumns("_timestamp", "id", "name", "json1", "array1"),
			},
			expectedRowsCount: 4,
			streamOptions: []bulker.StreamOption{bulker.WithSchema(types2.Schema{
				Name: "d",
				Fields: []types2.SchemaField{
					{Name: "_timestamp", Type: types2.TIMESTAMP},
					{Name: "id", Type: types2.INT64},
					{Name: "name", Type: types2.STRING},
					{Name: "json1", Type: types2.JSON},
					{Name: "array1", Type: types2.JSON},
				},
			})},
			configIds: utils.ArrayExcluding(allBulkerConfigs, BigqueryBulkerTypeId),
		},
		{
			name:                "added_columns_third_run",
			tableName:           "transactional_json_string_test",
			modes:               []bulker.BulkMode{bulker.Batch},
			leaveResultingTable: true,
			dataFile:            "test_data/types_json_part3.ndjson",
			expectedTable: ExpectedTable{
				Columns: justColumns("_timestamp", "id", "name", "json1", "array1"),
			},
			expectedRowsCount: 5,
			streamOptions: []bulker.StreamOption{bulker.WithSchema(types2.Schema{
				Name: "d",
				Fields: []types2.SchemaField{
					{Name: "_timestamp", Type: types2.TIMESTAMP},
					{Name: "id", Type: types2.INT64},
					{Name: "name", Type: types2.STRING},
					{Name: "json1", Type: types2.JSON},
					{Name: "array1", Type: types2.JSON},
				},
			})},
			configIds: utils.ArrayExcluding(allBulkerConfigs, BigqueryBulkerTypeId),
		},
		{
			name:      "dummy_test_table_cleanup",
			tableName: "transactional_json_string_test",
			modes:     []bulker.BulkMode{bulker.Batch},
			dataFile:  "test_data/empty.ndjson",
			configIds: utils.ArrayExcluding(allBulkerConfigs, BigqueryBulkerTypeId),
		},
	}
	sequentialGroup := sync.WaitGroup{}
	sequentialGroup.Add(1)
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			runTestConfig(t, tt, testStream)
			sequentialGroup.Done()
		})
		sequentialGroup.Wait()
		sequentialGroup.Add(1)
	}
}

func TestTransactionalJSONNoArrays(t *testing.T) {
	t.Parallel()
	tests := []bulkerTestConfig{
		{
			//deletes any table leftovers from previous tests
			name:      "dummy_test_table_cleanup",
			tableName: "transactional_json_no_arrays_test",
			modes:     []bulker.BulkMode{bulker.Batch},
			dataFile:  "test_data/empty.ndjson",
			configIds: []string{ClickHouseBulkerTypeId, ClickHouseBulkerTypeId + "_cluster_noshards", ClickHouseBulkerTypeId + "_replicated_db", ClickHouseBulkerTypeId + "_replicated_db_sharded"},
		},
		{
			name:                "added_columns_first_run",
			tableName:           "transactional_json_no_arrays_test",
			modes:               []bulker.BulkMode{bulker.Batch},
			leaveResultingTable: true,
			dataFile:            "test_data/types_json_noarr_part1.ndjson",
			expectedTable: ExpectedTable{
				Columns: justColumns("_timestamp", "id", "name", "json1"),
			},
			expectedRowsCount: 2,
			streamOptions: []bulker.StreamOption{bulker.WithSchema(types2.Schema{
				Name: "d",
				Fields: []types2.SchemaField{
					{Name: "_timestamp", Type: types2.TIMESTAMP},
					{Name: "id", Type: types2.INT64},
					{Name: "name", Type: types2.STRING},
					{Name: "json1", Type: types2.JSON},
				},
			})},
			configIds: []string{ClickHouseBulkerTypeId, ClickHouseBulkerTypeId + "_cluster_noshards", ClickHouseBulkerTypeId + "_replicated_db", ClickHouseBulkerTypeId + "_replicated_db_sharded"},
		},
		{
			name:                "added_columns_second_run",
			tableName:           "transactional_json_no_arrays_test",
			modes:               []bulker.BulkMode{bulker.Batch},
			leaveResultingTable: true,
			dataFile:            "test_data/types_json_noarr_part2.ndjson",
			expectedTable: ExpectedTable{
				Columns: justColumns("_timestamp", "id", "name", "json1"),
			},
			expectedRowsCount: 4,
			streamOptions: []bulker.StreamOption{bulker.WithSchema(types2.Schema{
				Name: "d",
				Fields: []types2.SchemaField{
					{Name: "_timestamp", Type: types2.TIMESTAMP},
					{Name: "id", Type: types2.INT64},
					{Name: "name", Type: types2.STRING},
					{Name: "json1", Type: types2.JSON},
				},
			})},
			configIds: []string{ClickHouseBulkerTypeId, ClickHouseBulkerTypeId + "_cluster_noshards", ClickHouseBulkerTypeId + "_replicated_db", ClickHouseBulkerTypeId + "_replicated_db_sharded"},
		},
		{
			name:      "dummy_test_table_cleanup",
			tableName: "transactional_json_no_arrays_test",
			modes:     []bulker.BulkMode{bulker.Batch},
			dataFile:  "test_data/empty.ndjson",
			configIds: []string{ClickHouseBulkerTypeId, ClickHouseBulkerTypeId + "_cluster_noshards", ClickHouseBulkerTypeId + "_replicated_db", ClickHouseBulkerTypeId + "_replicated_db_sharded"},
		},
	}
	sequentialGroup := sync.WaitGroup{}
	sequentialGroup.Add(1)
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			runTestConfig(t, tt, testStream)
			sequentialGroup.Done()
		})
		sequentialGroup.Wait()
		sequentialGroup.Add(1)
	}
}
