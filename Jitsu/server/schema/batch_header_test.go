package schema

import (
	"github.com/jitsucom/jitsu/server/test"
	"github.com/jitsucom/jitsu/server/typing"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestFieldMerge(t *testing.T) {
	tests := []struct {
		name     string
		current  Fields
		input    Fields
		expected Fields
	}{
		{
			"Empty current and input",
			Fields{},
			Fields{},
			Fields{},
		},
		{
			"Empty input",
			Fields{"col1": NewField(typing.STRING)},
			Fields{},
			Fields{"col1": NewField(typing.STRING)},
		},
		{
			"Merged ok",
			Fields{"col1": NewField(typing.STRING), "col2": NewField(typing.FLOAT64), "col3": NewField(typing.TIMESTAMP), "col4": NewField(typing.INT64)},
			Fields{"col1": NewField(typing.INT64), "col2": NewField(typing.STRING), "col3": NewField(typing.TIMESTAMP), "col5": NewField(typing.TIMESTAMP)},
			Fields{
				"col1": Field{
					dataType:       nil,
					typeOccurrence: map[typing.DataType]bool{typing.STRING: true, typing.INT64: true},
				},
				"col2": Field{
					dataType:       nil,
					typeOccurrence: map[typing.DataType]bool{typing.STRING: true, typing.FLOAT64: true},
				},
				"col3": NewField(typing.TIMESTAMP),
				"col4": NewField(typing.INT64),
				"col5": NewField(typing.TIMESTAMP),
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.current.Merge(tt.input)
			test.ObjectsEqual(t, tt.expected, tt.current, "Fields aren't equal")
		})
	}
}

func TestColumnGetType(t *testing.T) {
	ts := typing.TIMESTAMP
	tests := []struct {
		name     string
		input    Field
		expected typing.DataType
	}{
		{
			"int64+float64=float64",
			Field{
				dataType:       nil,
				typeOccurrence: map[typing.DataType]bool{typing.INT64: true, typing.FLOAT64: true},
			},
			typing.FLOAT64,
		},
		{
			"int64+string=string",
			Field{
				dataType:       nil,
				typeOccurrence: map[typing.DataType]bool{typing.INT64: true, typing.STRING: true},
			},
			typing.STRING,
		},
		{
			"int64+timestamp=string",
			Field{
				dataType:       nil,
				typeOccurrence: map[typing.DataType]bool{typing.INT64: true, typing.TIMESTAMP: true},
			},
			typing.STRING,
		},
		{
			"int64+timestamp+float64=string",
			Field{
				dataType:       nil,
				typeOccurrence: map[typing.DataType]bool{typing.INT64: true, typing.TIMESTAMP: true, typing.FLOAT64: true},
			},
			typing.STRING,
		},
		{
			"timestamp=timestamp",
			Field{
				dataType:       nil,
				typeOccurrence: map[typing.DataType]bool{typing.TIMESTAMP: true},
			},
			typing.TIMESTAMP,
		},
		{
			"non-existent case: dataType:timestamp, map[int64] = timestamp",
			Field{
				dataType:       &ts,
				typeOccurrence: map[typing.DataType]bool{typing.INT64: true},
			},
			typing.TIMESTAMP,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			actual := tt.input.GetType()
			require.Equal(t, tt.expected, actual, "Types aren't equal")
		})
	}
}

func TestOverrideTypes(t *testing.T) {
	i := typing.INT64
	s := typing.STRING
	ts := typing.TIMESTAMP
	tests := []struct {
		name       string
		initial    Fields
		toOverride Fields
		expected   Fields
	}{
		{
			"override ok",
			Fields{
				"field1": Field{
					dataType:       &s,
					typeOccurrence: map[typing.DataType]bool{typing.STRING: true},
				},
				"field2": Field{
					dataType:       &i,
					typeOccurrence: map[typing.DataType]bool{typing.INT64: true},
				},
			},
			Fields{
				"field2": Field{
					dataType:       &s,
					typeOccurrence: map[typing.DataType]bool{typing.STRING: true},
				},
				"field3": Field{
					dataType:       &ts,
					typeOccurrence: map[typing.DataType]bool{typing.TIMESTAMP: true},
				},
			},
			Fields{
				"field1": Field{
					dataType:       &s,
					typeOccurrence: map[typing.DataType]bool{typing.STRING: true},
				},
				"field2": Field{
					dataType:       &s,
					typeOccurrence: map[typing.DataType]bool{typing.STRING: true},
				},
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.initial.OverrideTypes(tt.toOverride)

			require.Equal(t, tt.expected, tt.initial, "Field types aren't equal")
		})
	}
}
