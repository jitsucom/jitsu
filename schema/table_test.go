package schema

import (
	"github.com/ksensehq/eventnative/test"
	"testing"
)

func TestDiff(t *testing.T) {
	tests := []struct {
		name         string
		dbSchema     *Table
		dataSchema   *Table
		expectedDiff *Table
	}{
		{
			"Empty db schema",
			&Table{Name: "empty", Columns: Columns{}},
			nil,
			&Table{Name: "empty", Columns: Columns{}},
		},
		{
			"Empty db and data schema",
			&Table{Name: "empty", Columns: Columns{}},
			&Table{Name: "empty", Columns: Columns{}},
			&Table{Name: "empty", Columns: Columns{}},
		},
		{
			"Empty data schema",
			&Table{Name: "some", Columns: Columns{"col1": Column{Type: STRING}}},
			&Table{Name: "some", Columns: Columns{}},
			&Table{Name: "some", Columns: Columns{}},
		},
		{
			"Equal db and data schema",
			&Table{Name: "some", Columns: Columns{"col1": Column{Type: STRING}, "col2": Column{Type: STRING}}},
			&Table{Name: "some", Columns: Columns{"col2": Column{Type: STRING}, "col1": Column{Type: STRING}}},
			&Table{Name: "some", Columns: Columns{}},
		},
		{
			"All diff",
			&Table{Name: "some", Columns: Columns{}},
			&Table{Name: "some", Columns: Columns{"col1": Column{Type: STRING}, "col2": Column{Type: STRING}}},
			&Table{Name: "some", Columns: Columns{"col2": Column{Type: STRING}, "col1": Column{Type: STRING}}},
		},
		{
			"Several fields diff",
			&Table{Name: "some", Columns: Columns{"col3": Column{Type: STRING}, "col4": Column{Type: STRING}}},
			&Table{Name: "some", Columns: Columns{"col1": Column{Type: STRING}, "col2": Column{Type: STRING}}},
			&Table{Name: "some", Columns: Columns{"col2": Column{Type: STRING}, "col1": Column{Type: STRING}}},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			diff := tt.dbSchema.Diff(tt.dataSchema)
			test.ObjectsEqual(t, tt.expectedDiff, diff, "Tables aren't equal")
		})
	}
}
