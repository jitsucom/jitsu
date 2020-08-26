package schema

import (
	"github.com/ksensehq/eventnative/test"
	"github.com/ksensehq/eventnative/typing"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestDiff(t *testing.T) {
	tests := []struct {
		name         string
		dbSchema     *Table
		dataSchema   *Table
		expectedDiff *Table
		expectedErr  string
	}{
		{
			"Empty db schema",
			&Table{Name: "empty", Columns: Columns{}},
			nil,
			&Table{Name: "empty", Columns: Columns{}},
			"",
		},
		{
			"Empty db and data schema",
			&Table{Name: "empty", Columns: Columns{}},
			&Table{Name: "empty", Columns: Columns{}},
			&Table{Name: "empty", Columns: Columns{}},
			"",
		},
		{
			"Empty data schema",
			&Table{Name: "some", Columns: Columns{"col1": NewColumn(typing.STRING)}},
			&Table{Name: "some", Columns: Columns{}},
			&Table{Name: "some", Columns: Columns{}},
			"",
		},
		{
			"Equal db and data schema",
			&Table{Name: "some", Columns: Columns{"col1": NewColumn(typing.STRING), "col2": NewColumn(typing.STRING)}},
			&Table{Name: "some", Columns: Columns{"col2": NewColumn(typing.STRING), "col1": NewColumn(typing.STRING)}},
			&Table{Name: "some", Columns: Columns{}},
			"",
		},
		{
			"All diff",
			&Table{Name: "some", Columns: Columns{}},
			&Table{Name: "some", Columns: Columns{"col1": NewColumn(typing.STRING), "col2": NewColumn(typing.STRING)}},
			&Table{Name: "some", Columns: Columns{"col2": NewColumn(typing.STRING), "col1": NewColumn(typing.STRING)}},
			"",
		},
		{
			"Several fields diff",
			&Table{Name: "some", Columns: Columns{"col3": NewColumn(typing.STRING), "col4": NewColumn(typing.STRING)}},
			&Table{Name: "some", Columns: Columns{"col1": NewColumn(typing.STRING), "col2": NewColumn(typing.STRING)}},
			&Table{Name: "some", Columns: Columns{"col2": NewColumn(typing.STRING), "col1": NewColumn(typing.STRING)}},
			"",
		},
		{
			"Diff ok with changed type convertible",
			&Table{Name: "some", Columns: Columns{"col1": NewColumn(typing.STRING), "col4": NewColumn(typing.STRING)}},
			&Table{Name: "some", Columns: Columns{"col1": NewColumn(typing.FLOAT64), "col2": NewColumn(typing.STRING)}},
			&Table{Name: "some", Columns: Columns{"col2": NewColumn(typing.STRING)}},
			"",
		},
		{
			"Diff err with changed type isn't convertible",
			&Table{Name: "some", Columns: Columns{"col1": NewColumn(typing.FLOAT64), "col4": NewColumn(typing.STRING)}},
			&Table{Name: "some", Columns: Columns{"col1": NewColumn(typing.STRING), "col2": NewColumn(typing.STRING)}},
			nil,
			"Unsupported column [col1] type changing from: STRING to: FLOAT64",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			diff, err := tt.dbSchema.Diff(tt.dataSchema)
			if tt.expectedErr != "" {
				require.EqualError(t, err, tt.expectedErr, "Errors aren't equal")
			} else {
				require.NoError(t, err)
				test.ObjectsEqual(t, tt.expectedDiff, diff, "Tables aren't equal")
			}
		})
	}
}

func TestColumnMerge(t *testing.T) {
	tests := []struct {
		name     string
		current  Columns
		input    Columns
		expected Columns
	}{
		{
			"Empty current and input",
			Columns{},
			Columns{},
			Columns{},
		},
		{
			"Empty input",
			Columns{"col1": NewColumn(typing.STRING)},
			Columns{},
			Columns{"col1": NewColumn(typing.STRING)},
		},
		{
			"Merged ok",
			Columns{"col1": NewColumn(typing.STRING), "col2": NewColumn(typing.FLOAT64), "col3": NewColumn(typing.TIMESTAMP), "col4": NewColumn(typing.INT64)},
			Columns{"col1": NewColumn(typing.INT64), "col2": NewColumn(typing.STRING), "col3": NewColumn(typing.TIMESTAMP), "col5": NewColumn(typing.TIMESTAMP)},
			Columns{
				"col1": Column{
					dataType:       nil,
					typeOccurrence: map[typing.DataType]bool{typing.STRING: true, typing.INT64: true},
				},
				"col2": Column{
					dataType:       nil,
					typeOccurrence: map[typing.DataType]bool{typing.STRING: true, typing.FLOAT64: true},
				},
				"col3": NewColumn(typing.TIMESTAMP),
				"col4": NewColumn(typing.INT64),
				"col5": NewColumn(typing.TIMESTAMP),
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.current.Merge(tt.input)
			test.ObjectsEqual(t, tt.expected, tt.current, "Columns aren't equal")
		})
	}
}

func TestColumnGetType(t *testing.T) {
	ts := typing.TIMESTAMP
	tests := []struct {
		name     string
		input    Column
		expected typing.DataType
	}{
		{
			"int64+float64=float64",
			Column{
				dataType:       nil,
				typeOccurrence: map[typing.DataType]bool{typing.INT64: true, typing.FLOAT64: true},
			},
			typing.FLOAT64,
		},
		{
			"int64+string=string",
			Column{
				dataType:       nil,
				typeOccurrence: map[typing.DataType]bool{typing.INT64: true, typing.STRING: true},
			},
			typing.STRING,
		},
		{
			"int64+timestamp=string",
			Column{
				dataType:       nil,
				typeOccurrence: map[typing.DataType]bool{typing.INT64: true, typing.TIMESTAMP: true},
			},
			typing.STRING,
		},
		{
			"int64+timestamp+float64=string",
			Column{
				dataType:       nil,
				typeOccurrence: map[typing.DataType]bool{typing.INT64: true, typing.TIMESTAMP: true, typing.FLOAT64: true},
			},
			typing.STRING,
		},
		{
			"timestamp=timestamp",
			Column{
				dataType:       nil,
				typeOccurrence: map[typing.DataType]bool{typing.TIMESTAMP: true},
			},
			typing.TIMESTAMP,
		},
		{
			"non-existent case: dataType:timestamp, map[int64] = timestamp",
			Column{
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
