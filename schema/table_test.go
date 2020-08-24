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
			&Table{Name: "some", Columns: Columns{"col1": Column{Type: typing.STRING}}},
			&Table{Name: "some", Columns: Columns{}},
			&Table{Name: "some", Columns: Columns{}},
			"",
		},
		{
			"Equal db and data schema",
			&Table{Name: "some", Columns: Columns{"col1": Column{Type: typing.STRING}, "col2": Column{Type: typing.STRING}}},
			&Table{Name: "some", Columns: Columns{"col2": Column{Type: typing.STRING}, "col1": Column{Type: typing.STRING}}},
			&Table{Name: "some", Columns: Columns{}},
			"",
		},
		{
			"All diff",
			&Table{Name: "some", Columns: Columns{}},
			&Table{Name: "some", Columns: Columns{"col1": Column{Type: typing.STRING}, "col2": Column{Type: typing.STRING}}},
			&Table{Name: "some", Columns: Columns{"col2": Column{Type: typing.STRING}, "col1": Column{Type: typing.STRING}}},
			"",
		},
		{
			"Several fields diff",
			&Table{Name: "some", Columns: Columns{"col3": Column{Type: typing.STRING}, "col4": Column{Type: typing.STRING}}},
			&Table{Name: "some", Columns: Columns{"col1": Column{Type: typing.STRING}, "col2": Column{Type: typing.STRING}}},
			&Table{Name: "some", Columns: Columns{"col2": Column{Type: typing.STRING}, "col1": Column{Type: typing.STRING}}},
			"",
		},
		{
			"Diff error column type was changed",
			&Table{Name: "some", Columns: Columns{"col1": Column{Type: typing.STRING}, "col4": Column{Type: typing.STRING}}},
			&Table{Name: "some", Columns: Columns{"col1": Column{Type: typing.FLOAT64}, "col2": Column{Type: typing.STRING}}},
			&Table{Name: "some", Columns: Columns{"col2": Column{Type: typing.STRING}, "col1": Column{Type: typing.STRING}}},
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
