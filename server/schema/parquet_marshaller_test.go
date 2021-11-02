package schema

import (
	"github.com/jitsucom/jitsu/server/typing"
	"github.com/stretchr/testify/require"
	"testing"
	"time"
)

func TestParquetMarshal(t *testing.T) {
	pm := NewParquetMarshaller()
	tests := []struct {
		name string
		pte  *parquetTestEntity
	}{
		{
			name: "all field types",
			pte:  allFieldTypesParquetTestEntity(),
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := pm.Marshal(tt.pte.batchHeader, []map[string]interface{}{tt.pte.inputObj})
			require.NoError(t, err, "parquet marshalling failed")
		})
	}
}

func TestParquetMetadata(t *testing.T) {
	pm := NewParquetMarshaller().(*ParquetMarshaller)
	tests := []struct {
		name string
		pte  *parquetTestEntity
	}{
		{
			name: "all field types",
			pte:  allFieldTypesParquetTestEntity(),
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			actualMd, actualFieldIndex := pm.parquetMetadata(tt.pte.batchHeader)
			require.ElementsMatchf(t, tt.pte.expectedMetadata, actualMd, "parquet metadata is not consistent with batch header")
			require.Equal(t, len(tt.pte.expectedMetadata), len(actualFieldIndex), "field index mapping is not consistent with batch header")
		})
	}
}

func TestParquetRecord(t *testing.T) {
	pm := NewParquetMarshaller().(*ParquetMarshaller)
	tests := []struct {
		name string
		pte  *parquetTestEntity
	}{
		{
			name: "all field types",
			pte:  allFieldTypesParquetTestEntity(),
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			actual := pm.parquetRecord(tt.pte.batchHeader, tt.pte.inputObj, fieldIndexStub(tt.pte.batchHeader))
			require.ElementsMatchf(t, tt.pte.expectedRecord, actual, "expected parquet record != actual parquet record")
		})
	}
}

type parquetTestEntity struct {
	//input
	batchHeader *BatchHeader
	inputObj    map[string]interface{}
	//expected result
	expectedMetadata []string
	expectedRecord   []interface{}
}

func allFieldTypesParquetTestEntity() *parquetTestEntity {
	testDatetime := time.Date(2021, 9, 27, 14, 56, 41, 0, time.UTC)
	return &parquetTestEntity{
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
		inputObj: map[string]interface{}{
			"field_int64":     12345,
			"field_string":    "some test string",
			"field_bool":      true,
			"field_float64":   56.78,
			"field_timestamp": testDatetime,
			"field_unknown":   "some unknown type",
		},
		expectedMetadata: []string{
			"name=field_int64, type=INT64",
			"name=field_string, type=BYTE_ARRAY, convertedtype=UTF8, encoding=PLAIN_DICTIONARY",
			"name=field_bool, type=BOOLEAN",
			"name=field_float64, type=DOUBLE",
			"name=field_timestamp, type=INT64, logicaltype=TIMESTAMP, logicaltype.isadjustedtoutc=true, logicaltype.unit=MILLIS",
			"name=field_unknown, type=BYTE_ARRAY, convertedtype=UTF8, encoding=PLAIN_DICTIONARY",
		},
		expectedRecord: []interface{}{
			12345,
			"some test string",
			true,
			56.78,
			testDatetime.Unix() * 1000,
			"UNKNOWN",
		},
	}
}

func fieldIndexStub(bh *BatchHeader) map[string]int {
	m := make(map[string]int, len(bh.Fields))
	i := 0
	for field := range bh.Fields {
		m[field] = i
		i++
	}
	return m
}
