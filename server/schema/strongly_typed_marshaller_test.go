package schema

import (
	"github.com/jitsucom/jitsu/server/typing"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestParquetMetadata(t *testing.T) {
	pm := NewParquetMarshaller().(*ParquetMarshaller)
	tests := []struct {
		name               string
		batchHeader        *BatchHeader
		expectedMetadata   []string
		expectedFieldIndex map[string]int
	}{
		{
			name: "all field types",
			batchHeader: &BatchHeader{
				TableName: "test_table",
				Fields: Fields{
					"field_int64": Field{
						dataType: typing.DataTypePtr(typing.INT64),
					},
					"field_string": Field{
						dataType: typing.DataTypePtr(typing.STRING),
					},
					"field_bool": Field{
						dataType: typing.DataTypePtr(typing.BOOL),
					},
					"field_float64": Field{
						dataType: typing.DataTypePtr(typing.FLOAT64),
					},
					"field_timestamp": Field{
						dataType: typing.DataTypePtr(typing.TIMESTAMP),
					},
					"field_unknown": Field{
						dataType: typing.DataTypePtr(typing.UNKNOWN),
					},
				},
			},
			expectedMetadata: []string{
				"name=field_int64, type=INT64",
				"name=field_string, type=BYTE_ARRAY, convertedtype=UTF8, encoding=PLAIN_DICTIONARY",
				"name=field_bool, type=BOOLEAN",
				"name=field_float64, type=DOUBLE",
				"name=field_timestamp, type=TIMESTAMP_MILLIS",
				"name=field_unknown, type=BYTE_ARRAY, convertedtype=UTF8, encoding=PLAIN_DICTIONARY",
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			actualMd, actualFieldIndex := pm.parquetMetadata(tt.batchHeader)
			require.ElementsMatchf(t, tt.expectedMetadata, actualMd, "parquet metadata is not consistent with batch header")
			require.Equal(t, len(tt.expectedMetadata), len(actualFieldIndex), "field index mapping is not consistent with batch header")
		})
	}
}
