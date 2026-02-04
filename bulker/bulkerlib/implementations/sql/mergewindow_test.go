package sql

import (
	"sync"
	"testing"
	"time"

	bulker "github.com/jitsucom/bulker/bulkerlib"
	"github.com/jitsucom/bulker/jitsubase/timestamp"
	"github.com/jitsucom/bulker/jitsubase/utils"
)

var mergeWindowTestTime = timestamp.MustParseTime(time.RFC3339Nano, "2023-02-07T00:00:00.000Z")

// TestTransactionalStream sequentially runs  transactional stream without dropping table in between
func TestMergeWindow(t *testing.T) {
	configIds := []string{SnowflakeBulkerTypeId, BigqueryBulkerTypeId, RedshiftBulkerTypeId, RedshiftBulkerTypeId + "_serverless", RedshiftBulkerTypeId + "_iam"}
	t.Parallel()
	tests := []bulkerTestConfig{
		{
			//deletes any table leftovers from previous tests
			name:      "dummy_test_table_cleanup",
			tableName: "merge_window",
			modes:     []bulker.BulkMode{bulker.Batch},
			dataFile:  "test_data/empty.ndjson",
			configIds: configIds,
		},
		{
			name:                "merge_window_first_run",
			tableName:           "merge_window",
			modes:               []bulker.BulkMode{bulker.Batch},
			leaveResultingTable: true,
			dataFile:            "test_data/merge_window1.ndjson",
			expectedRowsCount:   10,
			configIds:           configIds,
			frozenTime:          mergeWindowTestTime,
			streamOptions:       []bulker.StreamOption{bulker.WithTimestamp("_timestamp"), bulker.WithPrimaryKey("id"), bulker.WithDeduplicate()},
		},
		{
			name:                "merge_window_31_days",
			tableName:           "merge_window",
			modes:               []bulker.BulkMode{bulker.Batch},
			leaveResultingTable: true,
			dataFile:            "test_data/merge_window2.ndjson",
			configIds:           configIds,
			frozenTime:          mergeWindowTestTime,
			orderBy:             []string{"_timestamp", "name"},
			expectedRows: []map[string]any{
				{"_timestamp": timestamp.MustParseTime(time.RFC3339Nano, "2023-01-01T00:00:00.000Z"), "id": 1, "name": "test1"},
				{"_timestamp": timestamp.MustParseTime(time.RFC3339Nano, "2023-01-01T00:00:00.000Z"), "id": 1, "name": "test1B"},
				{"_timestamp": timestamp.MustParseTime(time.RFC3339Nano, "2023-01-05T00:00:00.000Z"), "id": 2, "name": "test2"},
				{"_timestamp": timestamp.MustParseTime(time.RFC3339Nano, "2023-01-05T00:00:00.000Z"), "id": 2, "name": "test2B"},
				{"_timestamp": timestamp.MustParseTime(time.RFC3339Nano, "2023-01-09T00:00:00.000Z"), "id": 3, "name": "test3B"},
				{"_timestamp": timestamp.MustParseTime(time.RFC3339Nano, "2023-01-13T00:00:00.000Z"), "id": 4, "name": "test4B"},
				{"_timestamp": timestamp.MustParseTime(time.RFC3339Nano, "2023-01-17T00:00:00.000Z"), "id": 5, "name": "test5B"},
				{"_timestamp": timestamp.MustParseTime(time.RFC3339Nano, "2023-01-21T00:00:00.000Z"), "id": 6, "name": "test6B"},
				{"_timestamp": timestamp.MustParseTime(time.RFC3339Nano, "2023-01-25T00:00:00.000Z"), "id": 7, "name": "test7B"},
				{"_timestamp": timestamp.MustParseTime(time.RFC3339Nano, "2023-01-29T00:00:00.000Z"), "id": 8, "name": "test8B"},
				{"_timestamp": timestamp.MustParseTime(time.RFC3339Nano, "2023-02-02T00:00:00.000Z"), "id": 9, "name": "test9B"},
				{"_timestamp": timestamp.MustParseTime(time.RFC3339Nano, "2023-02-07T00:00:00.000Z"), "id": 10, "name": "test10B"},
			},
			streamOptions: []bulker.StreamOption{bulker.WithTimestamp("_timestamp"), bulker.WithPrimaryKey("id"), bulker.WithDeduplicate(), WithDeduplicateWindow(31)},
		},
		{
			name:                "merge_window_5_days",
			tableName:           "merge_window",
			modes:               []bulker.BulkMode{bulker.Batch},
			leaveResultingTable: true,
			dataFile:            "test_data/merge_window3.ndjson",
			frozenTime:          mergeWindowTestTime,
			configIds:           configIds,
			orderBy:             []string{"_timestamp", "name"},
			expectedRows: []map[string]any{
				{"_timestamp": timestamp.MustParseTime(time.RFC3339Nano, "2023-01-01T00:00:00.000Z"), "id": 1, "name": "test1"},
				{"_timestamp": timestamp.MustParseTime(time.RFC3339Nano, "2023-01-01T00:00:00.000Z"), "id": 1, "name": "test1B"},
				{"_timestamp": timestamp.MustParseTime(time.RFC3339Nano, "2023-01-05T00:00:00.000Z"), "id": 2, "name": "test2"},
				{"_timestamp": timestamp.MustParseTime(time.RFC3339Nano, "2023-01-05T00:00:00.000Z"), "id": 2, "name": "test2B"},
				{"_timestamp": timestamp.MustParseTime(time.RFC3339Nano, "2023-01-09T00:00:00.000Z"), "id": 3, "name": "test3B"},
				{"_timestamp": timestamp.MustParseTime(time.RFC3339Nano, "2023-01-13T00:00:00.000Z"), "id": 4, "name": "test4B"},
				{"_timestamp": timestamp.MustParseTime(time.RFC3339Nano, "2023-01-17T00:00:00.000Z"), "id": 5, "name": "test5B"},
				{"_timestamp": timestamp.MustParseTime(time.RFC3339Nano, "2023-01-21T00:00:00.000Z"), "id": 6, "name": "test6B"},
				{"_timestamp": timestamp.MustParseTime(time.RFC3339Nano, "2023-01-25T00:00:00.000Z"), "id": 7, "name": "test7B"},
				{"_timestamp": timestamp.MustParseTime(time.RFC3339Nano, "2023-01-25T00:00:00.000Z"), "id": 7, "name": "test7C"},
				{"_timestamp": timestamp.MustParseTime(time.RFC3339Nano, "2023-01-29T00:00:00.000Z"), "id": 8, "name": "test8B"},
				{"_timestamp": timestamp.MustParseTime(time.RFC3339Nano, "2023-01-29T00:00:00.000Z"), "id": 8, "name": "test8C"},
				{"_timestamp": timestamp.MustParseTime(time.RFC3339Nano, "2023-02-02T00:00:00.000Z"), "id": 9, "name": "test9C"},
				{"_timestamp": timestamp.MustParseTime(time.RFC3339Nano, "2023-02-07T00:00:00.000Z"), "id": 10, "name": "test10C"},
			},
			streamOptions: []bulker.StreamOption{bulker.WithTimestamp("_timestamp"), bulker.WithPrimaryKey("id"), bulker.WithDeduplicate(), WithDeduplicateWindow(5)},
		},
		{
			name:                "merge_window_auto",
			tableName:           "merge_window",
			modes:               []bulker.BulkMode{bulker.Batch},
			leaveResultingTable: true,
			dataFile:            "test_data/merge_window4.ndjson",
			frozenTime:          mergeWindowTestTime,
			configIds:           configIds,
			orderBy:             []string{"_timestamp", "name"},
			expectedRows: []map[string]any{
				{"_timestamp": timestamp.MustParseTime(time.RFC3339Nano, "2023-01-01T00:00:00.000Z"), "id": 1, "name": "test1"},
				{"_timestamp": timestamp.MustParseTime(time.RFC3339Nano, "2023-01-01T00:00:00.000Z"), "id": 1, "name": "test1B"},
				{"_timestamp": timestamp.MustParseTime(time.RFC3339Nano, "2023-01-05T00:00:00.000Z"), "id": 2, "name": "test2"},
				{"_timestamp": timestamp.MustParseTime(time.RFC3339Nano, "2023-01-05T00:00:00.000Z"), "id": 2, "name": "test2B"},
				{"_timestamp": timestamp.MustParseTime(time.RFC3339Nano, "2023-01-09T00:00:00.000Z"), "id": 3, "name": "test3B"},
				{"_timestamp": timestamp.MustParseTime(time.RFC3339Nano, "2023-01-13T00:00:00.000Z"), "id": 4, "name": "test4B"},
				{"_timestamp": timestamp.MustParseTime(time.RFC3339Nano, "2023-01-17T00:00:00.000Z"), "id": 5, "name": "test5B"},
				{"_timestamp": timestamp.MustParseTime(time.RFC3339Nano, "2023-01-21T00:00:00.000Z"), "id": 6, "name": "test6B"},
				{"_timestamp": timestamp.MustParseTime(time.RFC3339Nano, "2023-01-25T00:00:00.000Z"), "id": 7, "name": "test7B"},
				{"_timestamp": timestamp.MustParseTime(time.RFC3339Nano, "2023-01-25T00:00:00.000Z"), "id": 7, "name": "test7C"},
				{"_timestamp": timestamp.MustParseTime(time.RFC3339Nano, "2023-01-29T00:00:00.000Z"), "id": 8, "name": "test8B"},
				{"_timestamp": timestamp.MustParseTime(time.RFC3339Nano, "2023-01-29T00:00:00.000Z"), "id": 8, "name": "test8C"},
				{"_timestamp": timestamp.MustParseTime(time.RFC3339Nano, "2023-02-02T00:00:00.000Z"), "id": 9, "name": "test9D"},
				{"_timestamp": timestamp.MustParseTime(time.RFC3339Nano, "2023-02-07T00:00:00.000Z"), "id": 10, "name": "test10D"},
			},
			streamOptions: []bulker.StreamOption{bulker.WithTimestamp("_timestamp"), bulker.WithPrimaryKey("id"), bulker.WithDeduplicate(), WithDeduplicateWindow(365)},
		},
		{
			name:      "dummy_test_table_cleanup",
			tableName: "merge_window",
			modes:     []bulker.BulkMode{bulker.Batch},
			dataFile:  "test_data/empty.ndjson",
			configIds: configIds,
		},
	}
	if len(utils.ArrayIntersection(allBulkerConfigs, configIds)) > 0 {
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
}
