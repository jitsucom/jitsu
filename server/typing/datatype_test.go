package typing

import (
	"encoding/json"
	"github.com/jitsucom/jitsu/server/timestamp"
	"github.com/stretchr/testify/require"
	"reflect"
	"testing"
)

func TestDataTypeValues(t *testing.T) {
	require.Equal(t, DataType(0), UNKNOWN)
	require.Equal(t, DataType(1), BOOL)
	require.Equal(t, DataType(2), INT64)
	require.Equal(t, DataType(3), FLOAT64)
	require.Equal(t, DataType(4), STRING)
	require.Equal(t, DataType(5), TIMESTAMP)
}

func TestTypeFromString(t *testing.T) {
	tests := []struct {
		name        string
		input       string
		expected    DataType
		expectedErr string
	}{
		{
			"Empty input string",
			"",
			UNKNOWN,
			"Unknown casting type: ",
		},
		{
			"Unknown type",
			"float",
			UNKNOWN,
			"Unknown casting type: float",
		},
		{
			"String ok",
			"string",
			STRING,
			"",
		},
		{
			"Integer with camel case and spaces ok",
			" InTeGer ",
			INT64,
			"",
		},
		{
			"Double ok",
			"double",
			FLOAT64,
			"",
		},
		{
			"Timestamp ok",
			"timestamp",
			TIMESTAMP,
			"",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			actual, err := TypeFromString(tt.input)
			if tt.expectedErr != "" {
				require.EqualError(t, err, tt.expectedErr, "Errors aren't equal")
			} else {
				require.Equal(t, tt.expected, actual, "DataTypes aren't equal")
			}
		})
	}
}

func TestStringFromType(t *testing.T) {
	tests := []struct {
		name        string
		input       DataType
		expected    string
		expectedErr string
	}{
		{
			"Unknown type",
			UNKNOWN,
			"",
			"Unable to get string from DataType for: UNKNOWN",
		},
		{
			"String ok",
			STRING,
			"string",
			"",
		},
		{
			"Int64 ok",
			INT64,
			"integer",
			"",
		},
		{
			"Float64 ok",
			FLOAT64,
			"double",
			"",
		},
		{
			"Timestamp ok",
			TIMESTAMP,
			"timestamp",
			"",
		},
		{
			"Boolean ok",
			BOOL,
			"boolean",
			"",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			actual, err := StringFromType(tt.input)
			if tt.expectedErr != "" {
				require.EqualError(t, err, tt.expectedErr, "Errors aren't equal")
			} else {
				require.Equal(t, tt.expected, actual, "strings aren't equal")
			}
		})
	}
}

func TestTypeFromValue(t *testing.T) {
	tests := []struct {
		name        string
		input       interface{}
		expected    DataType
		expectedErr string
	}{
		{
			"Unknown nil",
			nil,
			UNKNOWN,
			"Unknown DataType for value: <nil> type: %!t(<nil>)",
		},
		{
			"String ok",
			"abc",
			STRING,
			"",
		},
		{
			"Float32 with zero -> float64",
			float32(123.0),
			FLOAT64,
			"",
		},
		{
			"Float64 -> float64",
			123.0,
			FLOAT64,
			"",
		},
		{
			"Float32 ok",
			float32(123.1),
			FLOAT64,
			"",
		},
		{
			"Float64 ok",
			123.0000000001,
			FLOAT64,
			"",
		},
		{
			"Int ok",
			123,
			INT64,
			"",
		},
		{
			"Int8 ok",
			int8(123),
			INT64,
			"",
		},
		{
			"Int16 ok",
			int16(123),
			INT64,
			"",
		},
		{
			"Int32 ok",
			int32(123),
			INT64,
			"",
		},
		{
			"Int64 ok",
			int64(123),
			INT64,
			"",
		},
		{
			"bool true ok",
			true,
			BOOL,
			"",
		},
		{
			"bool false ok",
			false,
			BOOL,
			"",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			actual, err := TypeFromValue(tt.input)
			if tt.expectedErr != "" {
				require.EqualError(t, err, tt.expectedErr, "Errors aren't equal")
			} else {
				require.NoError(t, err)
				require.Equal(t, tt.expected, actual, "types aren't equal")
			}
		})
	}
}

func TestReformat(t *testing.T) {
	tests := []struct {
		name         string
		input        interface{}
		expectedType string
	}{
		{
			"Unknown nil",
			nil,
			"",
		},
		{
			"boolean",
			true,
			"bool",
		},
		{
			"string",
			"v",
			"string",
		},
		{
			"json float",
			json.Number("5.5"),
			"float64",
		},
		{
			"json float with zero",
			json.Number("5.0"),
			"float64",
		},
		{
			"json int",
			json.Number("5"),
			"int64",
		},
		{
			"error wrong number",
			json.Number("aa"),
			"json.Number",
		},
		{
			"error empty string",
			json.Number(""),
			"json.Number",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			actual := ReformatNumberValue(tt.input)
			if tt.expectedType != "" {
				require.Equal(t, tt.expectedType, reflect.TypeOf(actual).String(), "types aren't equal")
			}
		})
	}
}

func TestReformatTimeValue(t *testing.T) {
	tests := []struct {
		name         string
		input        interface{}
		expectedType string
	}{
		{
			"Unknown nil",
			nil,
			"",
		},
		{
			"Any string",
			"Some string",
			"string",
		},
		{
			"Current time",
			timestamp.Now(),
			"time.Time",
		},
		{
			"ISO time 0",
			"2021-03-05T20:21:03Z",
			"time.Time",
		},
		{
			"ISO time 1",
			"2021-03-05T20:21:03.1Z",
			"time.Time",
		},
		{
			"ISO time 2",
			"2021-03-05T20:21:03.12Z",
			"time.Time",
		},
		{
			"ISO time 3",
			"2021-03-05T20:21:03.123Z",
			"time.Time",
		},
		{
			"ISO time 4",
			"2021-03-05T20:21:03.1234Z",
			"time.Time",
		},
		{
			"ISO time 5",
			"2021-03-05T20:21:03.12345Z",
			"time.Time",
		},
		{
			"ISO time 6",
			"2021-03-05T20:21:03.123456Z",
			"time.Time",
		},
		{
			"ISO time 7",
			"2021-03-05T20:21:03.1234567Z",
			"time.Time",
		},
		{
			"ISO time 8",
			"2021-03-05T20:21:03.12345678Z",
			"time.Time",
		},
		{
			"ISO time 9",
			"2021-03-05T20:21:03.123456789Z",
			"time.Time",
		},
		{
			"Not ISO time",
			"2021-03-05T20:21:03.1234567898Z",
			"string",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			actual := ReformatTimeValue(tt.input)
			if tt.expectedType != "" {
				require.Equal(t, tt.expectedType, reflect.TypeOf(actual).String(), "types aren't equal")
			}
		})
	}
}
