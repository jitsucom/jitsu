package adapters

import (
	"github.com/jitsucom/jitsu/server/test"
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
			&Table{Name: "empty", Columns: map[string]Column{}, PKFields: map[string]bool{}},
		},
		{
			"Empty db and data schema",
			&Table{Name: "empty", Columns: Columns{}},
			&Table{Name: "empty", Columns: Columns{}},
			&Table{Name: "empty", Columns: map[string]Column{}, PKFields: map[string]bool{}},
		},
		{
			"Empty data schema",
			&Table{Name: "some", Columns: Columns{"col1": Column{SQLType: "text"}}},
			&Table{Name: "some", Columns: Columns{}},
			&Table{Name: "some", Columns: map[string]Column{}, PKFields: map[string]bool{}},
		},
		{
			"Equal db and data schema",
			&Table{Name: "some", Columns: Columns{"col1": Column{SQLType: "text"}, "col2": Column{SQLType: "bigint"}}},
			&Table{Name: "some", Columns: Columns{"col2": Column{SQLType: "bigint"}, "col1": Column{SQLType: "text"}}},
			&Table{Name: "some", Columns: map[string]Column{}, PKFields: map[string]bool{}},
		},
		{
			"All diff",
			&Table{Name: "some", Columns: Columns{}},
			&Table{Name: "some", Columns: Columns{"col1": Column{SQLType: "text"}, "col2": Column{SQLType: "bigint"}}},
			&Table{Name: "some", Columns: Columns{"col2": Column{SQLType: "bigint"}, "col1": Column{SQLType: "text"}}, PKFields: map[string]bool{}},
		},
		{
			"Several fields diff",
			&Table{Name: "some", Columns: Columns{"col3": Column{SQLType: "text"}, "col4": Column{SQLType: "text"}}},
			&Table{Name: "some", Columns: Columns{"col1": Column{SQLType: "text"}, "col2": Column{SQLType: "text"}}},
			&Table{Name: "some", Columns: Columns{"col2": Column{SQLType: "text"}, "col1": Column{SQLType: "text"}}, PKFields: map[string]bool{}},
		},
		{
			"Diff ok with same type",
			&Table{Name: "some", Columns: Columns{"col1": Column{SQLType: "text"}, "col4": Column{SQLType: "text"}}},
			&Table{Name: "some", Columns: Columns{"col1": Column{SQLType: "text"}, "col2": Column{SQLType: "text"}}},
			&Table{Name: "some", Columns: Columns{"col2": Column{SQLType: "text"}}, PKFields: map[string]bool{}},
		},
		{
			"Diff with changed type",
			&Table{Name: "some", Columns: Columns{"col1": Column{SQLType: "text"}, "col4": Column{SQLType: "text"}}},
			&Table{Name: "some", Columns: Columns{"col1": Column{SQLType: "bigint"}, "col2": Column{SQLType: "bigint"}}},
			&Table{Name: "some", Columns: Columns{"col2": Column{SQLType: "bigint"}}, PKFields: map[string]bool{}},
		},
		{
			"Diff with same primary keys",
			&Table{Name: "some", Columns: Columns{"col1": Column{SQLType: "text"}, "col4": Column{SQLType: "text"}}, PKFields: map[string]bool{"col1": true}},
			&Table{Name: "some", Columns: Columns{"col1": Column{SQLType: "text"}}, PKFields: map[string]bool{"col1": true}},
			&Table{Name: "some", Columns: Columns{}, PKFields: map[string]bool{}, DeletePkFields: false},
		},
		{
			"Diff with deleted primary keys",
			&Table{Name: "some", Columns: Columns{"col1": Column{SQLType: "text"}, "col4": Column{SQLType: "text"}}, PKFields: map[string]bool{"col1": true}},
			&Table{Name: "some", Columns: Columns{"col1": Column{SQLType: "text"}}},
			&Table{Name: "some", Columns: Columns{}, PKFields: map[string]bool{}, DeletePkFields: true},
		},
		{
			"Diff with added primary keys",
			&Table{Name: "some", Columns: Columns{"col1": Column{SQLType: "text"}, "col4": Column{SQLType: "text"}}},
			&Table{Name: "some", Columns: Columns{"col1": Column{SQLType: "text"}}, PKFields: map[string]bool{"col1": true}},
			&Table{Name: "some", Columns: Columns{}, PKFields: map[string]bool{"col1": true}, DeletePkFields: false},
		},
		{
			"Diff with changed primary keys",
			&Table{Name: "some", Columns: Columns{"col1": Column{SQLType: "text"}, "col4": Column{SQLType: "text"}}, PKFields: map[string]bool{"col1": true}},
			&Table{Name: "some", Columns: Columns{"col1": Column{SQLType: "text"}, "col4": Column{SQLType: "text"}, "col5": Column{SQLType: "text"}}, PKFields: map[string]bool{"col1": true, "col4": true}},
			&Table{Name: "some", Columns: Columns{"col5": Column{SQLType: "text"}}, PKFields: map[string]bool{"col1": true, "col4": true}, DeletePkFields: true},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			diff := tt.dbSchema.Diff(tt.dataSchema)
			test.ObjectsEqual(t, tt.expectedDiff, diff, "Tables aren't equal")
		})
	}
}
