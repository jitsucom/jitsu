package sql

import (
	bulker "github.com/jitsucom/bulker/bulkerlib"
	"sync"
	"testing"
)

func TestTransactionalSequentialRepeatPKWithNamespace(t *testing.T) {
	t.Parallel()
	tests := []bulkerTestConfig{
		{
			//deletes any table leftovers from previous tests
			name:           "dummy_test_table_cleanup",
			namespace:      testNamespace("mynamespace2"),
			tableName:      "transactional_test_pk_namespace",
			modes:          []bulker.BulkMode{bulker.Batch},
			dataFile:       "test_data/empty.ndjson",
			streamOptions:  []bulker.StreamOption{bulker.WithPrimaryKey("id"), bulker.WithDeduplicate(), bulker.WithNamespace(testNamespace("mynamespace2"))},
			expectedErrors: map[string]any{"create_stream_bigquery_stream": BigQueryAutocommitUnsupported},
			configIds:      allBulkerConfigs,
		},
		{
			name:                "first_run_batch",
			namespace:           testNamespace("mynamespace2"),
			tableName:           "transactional_test_pk_namespace",
			modes:               []bulker.BulkMode{bulker.Batch},
			leaveResultingTable: true,
			dataFile:            "test_data/repeated_ids.ndjson",
			expectedRows: []map[string]any{
				{"_timestamp": constantTime, "id": 1, "name": "test7"},
				{"_timestamp": constantTime, "id": 2, "name": "test1"},
				{"_timestamp": constantTime, "id": 3, "name": "test6"},
				{"_timestamp": constantTime, "id": 4, "name": "test5"},
			},
			configIds:      allBulkerConfigs,
			expectedErrors: map[string]any{"create_stream_bigquery_stream": BigQueryAutocommitUnsupported},
			streamOptions:  []bulker.StreamOption{bulker.WithPrimaryKey("id"), bulker.WithDeduplicate(), bulker.WithNamespace(testNamespace("mynamespace2"))},
		},
		{
			name:                "second_run_batch",
			namespace:           testNamespace("mynamespace2"),
			tableName:           "transactional_test_pk_namespace",
			modes:               []bulker.BulkMode{bulker.Batch},
			leaveResultingTable: true,
			dataFile:            "test_data/repeated_ids2.ndjson",
			expectedRows: []map[string]any{
				{"_timestamp": constantTime, "id": 1, "name": "test7"},
				{"_timestamp": constantTime, "id": 2, "name": "test1"},
				{"_timestamp": constantTime, "id": 3, "name": "test13"},
				{"_timestamp": constantTime, "id": 4, "name": "test14"},
				{"_timestamp": constantTime, "id": 5, "name": "test15"},
			},
			streamOptions:  []bulker.StreamOption{bulker.WithPrimaryKey("id"), bulker.WithDeduplicate(), bulker.WithNamespace(testNamespace("mynamespace2"))},
			expectedErrors: map[string]any{"create_stream_bigquery_stream": BigQueryAutocommitUnsupported},
			configIds:      allBulkerConfigs,
		},
		{
			name:           "dummy_test_table_cleanup",
			namespace:      testNamespace("mynamespace2"),
			tableName:      "transactional_test_pk_namespace",
			modes:          []bulker.BulkMode{bulker.Batch},
			dataFile:       "test_data/empty.ndjson",
			streamOptions:  []bulker.StreamOption{bulker.WithPrimaryKey("id"), bulker.WithDeduplicate(), bulker.WithNamespace(testNamespace("mynamespace2"))},
			expectedErrors: map[string]any{"create_stream_bigquery_stream": BigQueryAutocommitUnsupported},
			configIds:      allBulkerConfigs,
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

// TestReplaceTableStream sequentially runs 3 replace table streams without dropping table in between
func TestReplaceTableStreamWithNamespace(t *testing.T) {
	t.Parallel()
	tests := []bulkerTestConfig{
		{
			//delete any table leftovers from previous tests
			name:          "dummy_test_table_cleanup",
			namespace:     testNamespace("mynamespace"),
			tableName:     "replace_table_test_nsp",
			modes:         []bulker.BulkMode{bulker.ReplaceTable},
			dataFile:      "test_data/empty.ndjson",
			configIds:     allBulkerConfigs,
			streamOptions: []bulker.StreamOption{bulker.WithNamespace(testNamespace("mynamespace"))},
		},
		{
			name:                "first_run",
			namespace:           testNamespace("mynamespace"),
			tableName:           "replace_table_test_nsp",
			modes:               []bulker.BulkMode{bulker.ReplaceTable},
			leaveResultingTable: true,
			dataFile:            "test_data/partition1.ndjson",
			expectedRowsCount:   5,
			configIds:           allBulkerConfigs,
			streamOptions:       []bulker.StreamOption{bulker.WithNamespace(testNamespace("mynamespace"))},
		},
		{
			name:                "second_run",
			namespace:           testNamespace("mynamespace"),
			tableName:           "replace_table_test_nsp",
			modes:               []bulker.BulkMode{bulker.ReplaceTable},
			leaveResultingTable: true,
			dataFile:            "test_data/replace_table.ndjson",
			expectedRows: []map[string]any{
				{"_timestamp": constantTime, "id": 11, "name": "test11", "name2": "a"},
				{"_timestamp": constantTime, "id": 12, "name": "test12", "name2": "a"},
				{"_timestamp": constantTime, "id": 13, "name": "test13", "name2": "a"},
				{"_timestamp": constantTime, "id": 14, "name": "test14", "name2": "a"},
				{"_timestamp": constantTime, "id": 15, "name": "test15", "name2": "a"},
				{"_timestamp": constantTime, "id": 16, "name": "test16", "name2": "a"},
				{"_timestamp": constantTime, "id": 17, "name": "test17", "name2": "a"},
				{"_timestamp": constantTime, "id": 18, "name": "test18", "name2": "a"},
				{"_timestamp": constantTime, "id": 19, "name": "test19", "name2": "a"},
				{"_timestamp": constantTime, "id": 20, "name": "test20", "name2": "a"},
			},
			configIds:     allBulkerConfigs,
			streamOptions: []bulker.StreamOption{bulker.WithNamespace(testNamespace("mynamespace"))},
		},
		{
			name:                "empty_run",
			namespace:           testNamespace("mynamespace"),
			tableName:           "replace_table_test_nsp",
			leaveResultingTable: true,
			modes:               []bulker.BulkMode{bulker.ReplaceTable},
			dataFile:            "test_data/empty.ndjson",
			expectedRowsCount:   0,
			configIds:           allBulkerConfigs,
			streamOptions:       []bulker.StreamOption{bulker.WithNamespace(testNamespace("mynamespace"))},
		},
		{
			name:          "dummy_test_table_cleanup",
			namespace:     testNamespace("mynamespace"),
			tableName:     "replace_table_test_nsp",
			modes:         []bulker.BulkMode{bulker.ReplaceTable},
			dataFile:      "test_data/empty.ndjson",
			configIds:     allBulkerConfigs,
			streamOptions: []bulker.StreamOption{bulker.WithNamespace(testNamespace("mynamespace"))},
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

func TestReplacePartitionStreamWithNamespace(t *testing.T) {
	t.Parallel()
	tests := []bulkerTestConfig{
		{
			//delete any table leftovers from previous tests
			name:          "dummy_test_table_cleanup",
			namespace:     testNamespace("mynsp3"),
			tableName:     "replace_partition_test_namespace",
			modes:         []bulker.BulkMode{bulker.ReplacePartition},
			dataFile:      "test_data/empty.ndjson",
			streamOptions: []bulker.StreamOption{bulker.WithPartition("1"), bulker.WithNamespace(testNamespace("mynsp3"))},
			configIds:     allBulkerConfigs,
		},
		{
			name:                "first_partition",
			namespace:           testNamespace("mynsp3"),
			tableName:           "replace_partition_test_namespace",
			modes:               []bulker.BulkMode{bulker.ReplacePartition},
			leaveResultingTable: true,
			dataFile:            "test_data/partition1.ndjson",
			expectedRows: []map[string]any{
				{"_timestamp": constantTime, "id": 1, "name": "test", "__partition_id": "1"},
				{"_timestamp": constantTime, "id": 2, "name": "test2", "__partition_id": "1"},
				{"_timestamp": constantTime, "id": 3, "name": "test3", "__partition_id": "1"},
				{"_timestamp": constantTime, "id": 4, "name": "test4", "__partition_id": "1"},
				{"_timestamp": constantTime, "id": 5, "name": "test5", "__partition_id": "1"},
			},
			streamOptions: []bulker.StreamOption{bulker.WithPartition("1"), bulker.WithNamespace(testNamespace("mynsp3"))},
			configIds:     allBulkerConfigs,
		},
		{
			name:                "second_partition",
			namespace:           testNamespace("mynsp3"),
			tableName:           "replace_partition_test_namespace",
			modes:               []bulker.BulkMode{bulker.ReplacePartition},
			leaveResultingTable: true,
			dataFile:            "test_data/partition2.ndjson",
			expectedRows: []map[string]any{
				{"_timestamp": constantTime, "id": 1, "name": "test", "__partition_id": "1"},
				{"_timestamp": constantTime, "id": 2, "name": "test2", "__partition_id": "1"},
				{"_timestamp": constantTime, "id": 3, "name": "test3", "__partition_id": "1"},
				{"_timestamp": constantTime, "id": 4, "name": "test4", "__partition_id": "1"},
				{"_timestamp": constantTime, "id": 5, "name": "test5", "__partition_id": "1"},
				{"_timestamp": constantTime, "id": 11, "name": "test11", "__partition_id": "2"},
				{"_timestamp": constantTime, "id": 12, "name": "test12", "__partition_id": "2"},
				{"_timestamp": constantTime, "id": 13, "name": "test13", "__partition_id": "2"},
				{"_timestamp": constantTime, "id": 14, "name": "test14", "__partition_id": "2"},
				{"_timestamp": constantTime, "id": 15, "name": "test15", "__partition_id": "2"},
				{"_timestamp": constantTime, "id": 16, "name": "test16", "__partition_id": "2"},
				{"_timestamp": constantTime, "id": 17, "name": "test17", "__partition_id": "2"},
				{"_timestamp": constantTime, "id": 18, "name": "test18", "__partition_id": "2"},
				{"_timestamp": constantTime, "id": 19, "name": "test19", "__partition_id": "2"},
				{"_timestamp": constantTime, "id": 20, "name": "test20", "__partition_id": "2"},
			},
			streamOptions: []bulker.StreamOption{bulker.WithPartition("2"), bulker.WithNamespace(testNamespace("mynsp3"))},
			configIds:     allBulkerConfigs,
		},
		{
			name:                "first_partition_reprocess",
			namespace:           testNamespace("mynsp3"),
			tableName:           "replace_partition_test_namespace",
			modes:               []bulker.BulkMode{bulker.ReplacePartition},
			leaveResultingTable: true,
			dataFile:            "test_data/partition1_1.ndjson",
			expectedRows: []map[string]any{
				{"_timestamp": constantTime, "id": 6, "name": "test6", "__partition_id": "1"},
				{"_timestamp": constantTime, "id": 7, "name": "test7", "__partition_id": "1"},
				{"_timestamp": constantTime, "id": 8, "name": "test8", "__partition_id": "1"},
				{"_timestamp": constantTime, "id": 9, "name": "test9", "__partition_id": "1"},
				{"_timestamp": constantTime, "id": 10, "name": "test10", "__partition_id": "1"},
				{"_timestamp": constantTime, "id": 11, "name": "test11", "__partition_id": "2"},
				{"_timestamp": constantTime, "id": 12, "name": "test12", "__partition_id": "2"},
				{"_timestamp": constantTime, "id": 13, "name": "test13", "__partition_id": "2"},
				{"_timestamp": constantTime, "id": 14, "name": "test14", "__partition_id": "2"},
				{"_timestamp": constantTime, "id": 15, "name": "test15", "__partition_id": "2"},
				{"_timestamp": constantTime, "id": 16, "name": "test16", "__partition_id": "2"},
				{"_timestamp": constantTime, "id": 17, "name": "test17", "__partition_id": "2"},
				{"_timestamp": constantTime, "id": 18, "name": "test18", "__partition_id": "2"},
				{"_timestamp": constantTime, "id": 19, "name": "test19", "__partition_id": "2"},
				{"_timestamp": constantTime, "id": 20, "name": "test20", "__partition_id": "2"},
			},
			streamOptions: []bulker.StreamOption{bulker.WithPartition("1"), bulker.WithNamespace(testNamespace("mynsp3"))},
			configIds:     allBulkerConfigs,
		},
		{
			name:                "second_partition_empty",
			namespace:           testNamespace("mynsp3"),
			tableName:           "replace_partition_test_namespace",
			leaveResultingTable: true,
			modes:               []bulker.BulkMode{bulker.ReplacePartition},
			dataFile:            "test_data/empty.ndjson",
			expectedRows: []map[string]any{
				{"_timestamp": constantTime, "id": 6, "name": "test6", "__partition_id": "1"},
				{"_timestamp": constantTime, "id": 7, "name": "test7", "__partition_id": "1"},
				{"_timestamp": constantTime, "id": 8, "name": "test8", "__partition_id": "1"},
				{"_timestamp": constantTime, "id": 9, "name": "test9", "__partition_id": "1"},
				{"_timestamp": constantTime, "id": 10, "name": "test10", "__partition_id": "1"},
			},
			streamOptions: []bulker.StreamOption{bulker.WithPartition("2"), bulker.WithNamespace(testNamespace("mynsp3"))},
			configIds:     allBulkerConfigs,
		},
		{
			name:          "dummy_test_table_cleanup",
			namespace:     testNamespace("mynsp3"),
			tableName:     "replace_partition_test_namespace",
			modes:         []bulker.BulkMode{bulker.ReplacePartition},
			dataFile:      "test_data/empty.ndjson",
			streamOptions: []bulker.StreamOption{bulker.WithPartition("1"), bulker.WithNamespace(testNamespace("mynsp3"))},
			configIds:     allBulkerConfigs,
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
