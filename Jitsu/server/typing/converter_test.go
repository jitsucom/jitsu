package typing

import (
	"github.com/jitsucom/jitsu/server/test"
	"github.com/stretchr/testify/require"
	"testing"
	"time"
)

func TestConvert(t *testing.T) {
	tests := []struct {
		name        string
		inputValue  interface{}
		inputToType DataType
		expected    interface{}
		expectedErr string
	}{
		{
			"Nil input",
			nil,
			UNKNOWN,
			nil,
			"Unknown DataType for value: <nil> type: %!t(<nil>)",
		},
		{
			"Convert to UNKNOWN - error",
			"123",
			UNKNOWN,
			nil,
			"No rule for converting STRING to UNKNOWN",
		},
		{
			"Input value has already had toType",
			"123",
			STRING,
			"123",
			"",
		},
		{
			"int -> string",
			123,
			STRING,
			"123",
			"",
		},
		{
			"float -> string",
			123.523,
			STRING,
			"123.523",
			"",
		},
		{
			"timestamp -> string",
			time.Date(2020, 07, 20, 10, 15, 23, 22, time.UTC),
			STRING,
			"2020-07-20T10:15:23.000000Z",
			"",
		},
		{
			"int -> float",
			123,
			FLOAT64,
			float64(123),
			"",
		},
		/* Future
		{
				"string -> int ok",
				"123",
				INT64,
				int64(123),
				"",
			},
			{
				"string -> int error",
				"abc",
				INT64,
				0,
				"Error stringToInt() for value: abc: strconv.Atoi: parsing \"abc\": invalid syntax",
			},
			{
				"string -> float ok",
				"123.32",
				FLOAT64,
				123.32,
				"",
			},
			{
				"string -> float error",
				"dfg",
				FLOAT64,
				0,
				"Error stringToFloat() for value: dfg: strconv.ParseFloat: parsing \"dfg\": invalid syntax",
			},
			{
				"string -> timestamp ok",
				"2020-07-20T10:15:23.000000Z",
				TIMESTAMP,
				time.Date(2020, 07, 20, 10, 15, 23, 0, time.UTC),
				"",
			},
			{
				"string -> timestamp error",
				"2020/07/20",
				TIMESTAMP,
				0,
				"Error stringToTimestamp() for value: 2020/07/20: parsing time \"2020/07/20\" as \"2006-01-02T15:04:05.000000Z\": cannot parse \"/07/20\" as \"-\"",
			},
			{
				"float -> int",
				123.8492321,
				INT64,
				int64(123),
				"",
			},
		*/
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			castedValue, err := Convert(tt.inputToType, tt.inputValue)
			if tt.expectedErr != "" {
				require.EqualError(t, err, tt.expectedErr, "Errors aren't equal")
			} else {
				require.NoError(t, err)
				test.ObjectsEqual(t, tt.expected, castedValue, "Casted value isn't equal expected")
			}

		})
	}
}

func TestIsConvertible(t *testing.T) {
	tests := []struct {
		name     string
		from     DataType
		to       DataType
		expected bool
	}{
		{
			"Same types",
			STRING,
			STRING,
			true,
		},
		{
			"int64->string",
			INT64,
			STRING,
			true,
		},
		{
			"float64->string",
			FLOAT64,
			STRING,
			true,
		},
		{
			"timestamp->string",
			TIMESTAMP,
			STRING,
			true,
		},
		{
			"int64->float64",
			INT64,
			FLOAT64,
			true,
		},
		{
			"string->timestamp",
			STRING,
			TIMESTAMP,
			true,
		},
		{
			"timestamp->int64",
			TIMESTAMP,
			INT64,
			false,
		},
		{
			"float64->int64",
			FLOAT64,
			INT64,
			false,
		},
		{
			"string->int64",
			STRING,
			INT64,
			false,
		},
		{
			"string->float64",
			STRING,
			FLOAT64,
			false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			require.Equal(t, tt.expected, IsConvertible(tt.from, tt.to))
		})
	}
}

func TestGetCommonAncestorType(t *testing.T) {
	tests := []struct {
		name     string
		t1       DataType
		t2       DataType
		expected DataType
	}{
		{
			"string+string=string",
			STRING,
			STRING,
			STRING,
		},
		{
			"int64+float64=float64",
			INT64,
			FLOAT64,
			FLOAT64,
		},
		{
			"int64+string=string",
			INT64,
			STRING,
			STRING,
		},
		{
			"float64+string=string",
			FLOAT64,
			STRING,
			STRING,
		},
		{
			"timestamp+timestamp=timestamp",
			TIMESTAMP,
			TIMESTAMP,
			TIMESTAMP,
		},
		{
			"int64+timestamp=string",
			INT64,
			TIMESTAMP,
			STRING,
		},
		{
			"float64+timestamp=string",
			FLOAT64,
			TIMESTAMP,
			STRING,
		},
		{
			"string+timestamp=string",
			STRING,
			TIMESTAMP,
			STRING,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			require.Equal(t, tt.expected, GetCommonAncestorType(tt.t1, tt.t2))
		})
	}
}
