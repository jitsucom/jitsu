package schema

import (
	"github.com/jitsucom/jitsu/server/typing"
	"github.com/stretchr/testify/require"
	"testing"
	"time"
)

func TestNonGZIPParquetMarshal(t *testing.T) {
	pm := NewParquetMarshaller(false)
	tests := []struct {
		name string
		pte  *parquetTestEntity
	}{
		{
			name: "fields of all types, values are present",
			pte:  fieldOfAllTypesValuesArePresentParquetTestEntity(),
		},
		{
			name: "fields of all types, values are omitted",
			pte:  fieldsOfAllTypesValueOmittedParquetTestEntity(),
		},
		{
			name: "fields of all types, values are nil",
			pte: fieldsOfAllTypesValueAreNilParquetTestEntity(),
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := pm.Marshal(tt.pte.batchHeader, []map[string]interface{}{tt.pte.inputObj})
			require.NoError(t, err, "parquet marshalling failed")
		})
	}
}

func TestGZIPParquetMarshal(t *testing.T) {
	pm := NewParquetMarshaller(true)
	tests := []struct {
		name string
		pte  *parquetTestEntity
	}{
		{
			name: "fields of all types, values are present",
			pte:  fieldOfAllTypesValuesArePresentParquetTestEntity(),
		},
		{
			name: "fields of all types, values are omitted",
			pte:  fieldsOfAllTypesValueOmittedParquetTestEntity(),
		},
		{
			name: "fields of all types, values are nil",
			pte: fieldsOfAllTypesValueAreNilParquetTestEntity(),
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
	pm := NewParquetMarshaller(false).(*ParquetMarshaller)
	tests := []struct {
		name string
		pte  *parquetTestEntity
	}{
		{
			name: "fields of all types, values are present",
			pte:  fieldOfAllTypesValuesArePresentParquetTestEntity(),
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			actualMd, actualFieldIndex, _ := pm.parquetMetadata(tt.pte.batchHeader)
			require.ElementsMatchf(t, tt.pte.expectedMetadata, actualMd, "parquet metadata is not consistent with batch header")
			require.Equal(t, len(tt.pte.expectedMetadata), len(actualFieldIndex), "field index mapping is not consistent with batch header")
		})
	}
}

func TestParquetRecord(t *testing.T) {
	pm := NewParquetMarshaller(false).(*ParquetMarshaller)
	tests := []struct {
		name string
		pte  *parquetTestEntity
	}{
		{
			name: "fields of all types, values are present",
			pte:  fieldOfAllTypesValuesArePresentParquetTestEntity(),
		},
		{
			name: "fields of all types, values are omitted",
			pte:  fieldsOfAllTypesValueOmittedParquetTestEntity(),
		},
		{
			name: "fields of all types, values are nil",
			pte: fieldsOfAllTypesValueAreNilParquetTestEntity(),
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			actual, _ := pm.parquetRecord(metaStub(tt.pte.batchHeader), tt.pte.inputObj)
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

func fieldOfAllTypesValuesArePresentParquetTestEntity() *parquetTestEntity {
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
			},
		},
		inputObj: map[string]interface{}{
			"field_int64":     int64(12345),
			"field_string":    "some test string",
			"field_bool":      true,
			"field_float64":   56.78,
			"field_timestamp": testDatetime,
		},
		expectedMetadata: []string{
			"name=field_int64, type=INT64",
			"name=field_string, type=BYTE_ARRAY, convertedtype=UTF8, encoding=PLAIN_DICTIONARY",
			"name=field_bool, type=BOOLEAN",
			"name=field_float64, type=DOUBLE",
			"name=field_timestamp, type=INT64, logicaltype=TIMESTAMP, logicaltype.isadjustedtoutc=true, logicaltype.unit=MILLIS",
		},
		expectedRecord: []interface{}{
			int64(12345),
			"some test string",
			true,
			56.78,
			testDatetime.Unix() * 1000,
		},
	}
}

func fieldsOfAllTypesValueOmittedParquetTestEntity() *parquetTestEntity {
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
			},
		},
		inputObj: map[string]interface{}{},
		expectedMetadata: []string{
			"name=field_int64, type=INT64",
			"name=field_string, type=BYTE_ARRAY, convertedtype=UTF8, encoding=PLAIN_DICTIONARY",
			"name=field_bool, type=BOOLEAN",
			"name=field_float64, type=DOUBLE",
			"name=field_timestamp, type=INT64, logicaltype=TIMESTAMP, logicaltype.isadjustedtoutc=true, logicaltype.unit=MILLIS",
		},
		expectedRecord: []interface{}{
			int64(0),
			"",
			false,
			float64(0),
			int64(0),
		},
	}
}

func fieldsOfAllTypesValueAreNilParquetTestEntity() *parquetTestEntity {
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
			},
		},
		inputObj: map[string]interface{}{
			"field_int64":     nil,
			"field_string":    nil,
			"field_bool":      nil,
			"field_float64":   nil,
			"field_timestamp": nil,
		},
		expectedMetadata: []string{
			"name=field_int64, type=INT64",
			"name=field_string, type=BYTE_ARRAY, convertedtype=UTF8, encoding=PLAIN_DICTIONARY",
			"name=field_bool, type=BOOLEAN",
			"name=field_float64, type=DOUBLE",
			"name=field_timestamp, type=INT64, logicaltype=TIMESTAMP, logicaltype.isadjustedtoutc=true, logicaltype.unit=MILLIS",
		},
		expectedRecord: []interface{}{
			int64(0),
			"",
			false,
			float64(0),
			int64(0),
		},
	}
}

func metaStub(bh *BatchHeader) map[string]parquetMetadataItem {
	meta := make(map[string]parquetMetadataItem, len(bh.Fields))
	i := 0
	for field, fieldMeta := range bh.Fields {
		switch *fieldMeta.dataType {
		case typing.BOOL:
			meta[field] = parquetMetadataItem{i, typing.BOOL, false}
		case typing.INT64:
			meta[field] = parquetMetadataItem{i, typing.INT64, int64(0)}
		case typing.FLOAT64:
			meta[field] = parquetMetadataItem{i, typing.FLOAT64, float64(0)}
		case typing.STRING:
			meta[field] = parquetMetadataItem{i, typing.STRING, ""}
		case typing.TIMESTAMP:
			meta[field] = parquetMetadataItem{i, typing.TIMESTAMP, time.Time{}}
		}
		i++
	}
	return meta
}
