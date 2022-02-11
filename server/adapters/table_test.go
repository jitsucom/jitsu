package adapters

import (
	"github.com/jitsucom/jitsu/server/test"
	"github.com/jitsucom/jitsu/server/typing"
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
			&Table{Name: "empty", Columns: map[string]typing.SQLColumn{}, PKFields: map[string]bool{}},
		},
		{
			"Empty db and data schema",
			&Table{Name: "empty", Columns: Columns{}},
			&Table{Name: "empty", Columns: Columns{}},
			&Table{Name: "empty", Columns: map[string]typing.SQLColumn{}, PKFields: map[string]bool{}},
		},
		{
			"Empty data schema",
			&Table{Name: "some", Columns: Columns{"col1": typing.SQLColumn{Type: "text"}}},
			&Table{Name: "some", Columns: Columns{}},
			&Table{Name: "some", Columns: map[string]typing.SQLColumn{}, PKFields: map[string]bool{}},
		},
		{
			"Equal db and data schema",
			&Table{Name: "some", Columns: Columns{"col1": typing.SQLColumn{Type: "text"}, "col2": typing.SQLColumn{Type: "bigint"}}},
			&Table{Name: "some", Columns: Columns{"col2": typing.SQLColumn{Type: "bigint"}, "col1": typing.SQLColumn{Type: "text"}}},
			&Table{Name: "some", Columns: map[string]typing.SQLColumn{}, PKFields: map[string]bool{}},
		},
		{
			"All diff",
			&Table{Name: "some", Columns: Columns{}},
			&Table{Name: "some", Columns: Columns{"col1": typing.SQLColumn{Type: "text"}, "col2": typing.SQLColumn{Type: "bigint"}}},
			&Table{Name: "some", Columns: Columns{"col2": typing.SQLColumn{Type: "bigint"}, "col1": typing.SQLColumn{Type: "text"}}, PKFields: map[string]bool{}},
		},
		{
			"Several fields diff",
			&Table{Name: "some", Columns: Columns{"col3": typing.SQLColumn{Type: "text"}, "col4": typing.SQLColumn{Type: "text"}}},
			&Table{Name: "some", Columns: Columns{"col1": typing.SQLColumn{Type: "text"}, "col2": typing.SQLColumn{Type: "text"}}},
			&Table{Name: "some", Columns: Columns{"col2": typing.SQLColumn{Type: "text"}, "col1": typing.SQLColumn{Type: "text"}}, PKFields: map[string]bool{}},
		},
		{
			"Diff ok with same type",
			&Table{Name: "some", Columns: Columns{"col1": typing.SQLColumn{Type: "text"}, "col4": typing.SQLColumn{Type: "text"}}},
			&Table{Name: "some", Columns: Columns{"col1": typing.SQLColumn{Type: "text"}, "col2": typing.SQLColumn{Type: "text"}}},
			&Table{Name: "some", Columns: Columns{"col2": typing.SQLColumn{Type: "text"}}, PKFields: map[string]bool{}},
		},
		{
			"Diff with changed type",
			&Table{Name: "some", Columns: Columns{"col1": typing.SQLColumn{Type: "text"}, "col4": typing.SQLColumn{Type: "text"}}},
			&Table{Name: "some", Columns: Columns{"col1": typing.SQLColumn{Type: "bigint"}, "col2": typing.SQLColumn{Type: "bigint"}}},
			&Table{Name: "some", Columns: Columns{"col2": typing.SQLColumn{Type: "bigint"}}, PKFields: map[string]bool{}},
		},
		{
			"Diff with same primary keys",
			&Table{Name: "some", Columns: Columns{"col1": typing.SQLColumn{Type: "text"}, "col4": typing.SQLColumn{Type: "text"}}, PKFields: map[string]bool{"col1": true}},
			&Table{Name: "some", Columns: Columns{"col1": typing.SQLColumn{Type: "text"}}, PKFields: map[string]bool{"col1": true}},
			&Table{Name: "some", Columns: Columns{}, PKFields: map[string]bool{}, DeletePkFields: false},
		},
		{
			"Diff with deleted primary keys",
			&Table{Name: "some", Columns: Columns{"col1": typing.SQLColumn{Type: "text"}, "col4": typing.SQLColumn{Type: "text"}}, PKFields: map[string]bool{"col1": true}},
			&Table{Name: "some", Columns: Columns{"col1": typing.SQLColumn{Type: "text"}}},
			&Table{Name: "some", Columns: Columns{}, PKFields: map[string]bool{}, DeletePkFields: true},
		},
		{
			"Diff with added primary keys",
			&Table{Name: "some", Columns: Columns{"col1": typing.SQLColumn{Type: "text"}, "col4": typing.SQLColumn{Type: "text"}}},
			&Table{Name: "some", Columns: Columns{"col1": typing.SQLColumn{Type: "text"}}, PKFields: map[string]bool{"col1": true}},
			&Table{Name: "some", Columns: Columns{}, PKFields: map[string]bool{"col1": true}, PrimaryKeyName: "_some_pk", DeletePkFields: false},
		},
		{
			"Diff with changed primary keys",
			&Table{Name: "some", Columns: Columns{"col1": typing.SQLColumn{Type: "text"}, "col4": typing.SQLColumn{Type: "text"}}, PKFields: map[string]bool{"col1": true}},
			&Table{Name: "some", Columns: Columns{"col1": typing.SQLColumn{Type: "text"}, "col4": typing.SQLColumn{Type: "text"}, "col5": typing.SQLColumn{Type: "text"}}, PKFields: map[string]bool{"col1": true, "col4": true}},
			&Table{Name: "some", Columns: Columns{"col5": typing.SQLColumn{Type: "text"}}, PKFields: map[string]bool{"col1": true, "col4": true}, PrimaryKeyName: "_some_pk", DeletePkFields: true},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			diff := tt.dbSchema.Diff(tt.dataSchema)
			test.ObjectsEqual(t, tt.expectedDiff, diff, "Tables aren't equal")
		})
	}
}
