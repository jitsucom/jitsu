package sql

import (
	"testing"
	"time"

	bulker "github.com/jitsucom/bulker/bulkerlib"
	"github.com/jitsucom/bulker/jitsubase/timestamp"
)

var constantTimeA = timestamp.MustParseTime(time.RFC3339Nano, "2022-08-10T14:17:22.375Z")

func TestDeduplicateWithDiscriminator(t *testing.T) {
	t.Parallel()

	tests := []bulkerTestConfig{
		{
			name:     "dedup_with_no_discr",
			modes:    []bulker.BulkMode{bulker.Batch},
			dataFile: "test_data/repeated_ids_discr.ndjson",
			expectedRows: []map[string]any{
				{"_timestamp": constantTimeA, "id": 1, "name": "A", "int1": 1, "float1": 1.1},
				{"_timestamp": constantTimeA, "id": 2, "name": "A", "int1": 1, "float1": 1.1},
				{"_timestamp": constantTime, "id": 3, "name": "C", "int1": 3, "float1": 3.3},
			},
			configIds:     []string{PostgresBulkerTypeId, SnowflakeBulkerTypeId},
			streamOptions: []bulker.StreamOption{bulker.WithPrimaryKey("id"), bulker.WithDeduplicate()},
		},
		{
			name:     "dedup_with_discr_timestamp",
			modes:    []bulker.BulkMode{bulker.Batch},
			dataFile: "test_data/repeated_ids_discr.ndjson",
			expectedRows: []map[string]any{
				{"_timestamp": constantTime, "id": 1, "name": "C", "int1": 3, "float1": 3.3},
				{"_timestamp": constantTime, "id": 2, "name": "C", "int1": 3, "float1": 3.3},
				{"_timestamp": constantTime, "id": 3, "name": "C", "int1": 3, "float1": 3.3},
			},
			configIds:     []string{PostgresBulkerTypeId, SnowflakeBulkerTypeId},
			streamOptions: []bulker.StreamOption{bulker.WithPrimaryKey("id"), bulker.WithDeduplicate(), bulker.WithDiscriminatorField([]string{"_timestamp"})},
		},
		{
			name:     "dedup_with_discr_str",
			modes:    []bulker.BulkMode{bulker.Batch},
			dataFile: "test_data/repeated_ids_discr.ndjson",
			expectedRows: []map[string]any{
				{"_timestamp": constantTime, "id": 1, "name": "C", "int1": 3, "float1": 3.3},
				{"_timestamp": constantTime, "id": 2, "name": "C", "int1": 3, "float1": 3.3},
				{"_timestamp": constantTime, "id": 3, "name": "C", "int1": 3, "float1": 3.3},
			},
			configIds:     []string{PostgresBulkerTypeId, SnowflakeBulkerTypeId},
			streamOptions: []bulker.StreamOption{bulker.WithPrimaryKey("id"), bulker.WithDeduplicate(), bulker.WithDiscriminatorField([]string{"name"})},
		},
		{
			name:     "dedup_with_discr_int",
			modes:    []bulker.BulkMode{bulker.Batch},
			dataFile: "test_data/repeated_ids_discr.ndjson",
			expectedRows: []map[string]any{
				{"_timestamp": constantTime, "id": 1, "name": "C", "int1": 3, "float1": 3.3},
				{"_timestamp": constantTime, "id": 2, "name": "C", "int1": 3, "float1": 3.3},
				{"_timestamp": constantTime, "id": 3, "name": "C", "int1": 3, "float1": 3.3},
			},
			configIds:     []string{PostgresBulkerTypeId, SnowflakeBulkerTypeId},
			streamOptions: []bulker.StreamOption{bulker.WithPrimaryKey("id"), bulker.WithDeduplicate(), bulker.WithDiscriminatorField([]string{"int1"})},
		},
		{
			name:     "dedup_with_discr_float",
			modes:    []bulker.BulkMode{bulker.Batch},
			dataFile: "test_data/repeated_ids_discr.ndjson",
			expectedRows: []map[string]any{
				{"_timestamp": constantTime, "id": 1, "name": "C", "int1": 3, "float1": 3.3},
				{"_timestamp": constantTime, "id": 2, "name": "C", "int1": 3, "float1": 3.3},
				{"_timestamp": constantTime, "id": 3, "name": "C", "int1": 3, "float1": 3.3},
			},
			configIds:     []string{PostgresBulkerTypeId, SnowflakeBulkerTypeId},
			streamOptions: []bulker.StreamOption{bulker.WithPrimaryKey("id"), bulker.WithDeduplicate(), bulker.WithDiscriminatorField([]string{"float1"})},
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
