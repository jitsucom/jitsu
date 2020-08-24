package schema

import (
	"fmt"
	"github.com/ksensehq/eventnative/typing"
)

type TableNameExtractFunction func(map[string]interface{}) (string, error)
type Columns map[string]Column

type ColumnDiff struct {
	ColumnName   string
	CurrentType  typing.DataType
	IncomingType typing.DataType
}

//Merge add all columns from other to current instance
//note: assume that current columns and other columns have same column types
func (c Columns) Merge(other Columns) {
	for name, column := range other {
		c[name] = column
	}
}

//Header return comma separated column names string
func (c Columns) Header() string {
	header := ""
	for columnName := range c {
		header += columnName + ","
	}

	// Remove last comma
	if last := len(header) - 1; last >= 0 && header[last] == ',' {
		header = header[:last]
	}

	return header
}

// TypesDiff calculates diff between column types
// Return array of ColumnDiff where
// CurrentType - type of current object column
// IncomingType - type of another object column
func (c Columns) TypesDiff(another Columns) []*ColumnDiff {
	var diff []*ColumnDiff

	if another == nil || len(another) == 0 {
		return diff
	}

	for name, anotherColumn := range another {
		if currentColumn, ok := c[name]; ok && anotherColumn.Type != currentColumn.Type {
			diff = append(diff, &ColumnDiff{
				ColumnName:   name,
				CurrentType:  currentColumn.Type,
				IncomingType: anotherColumn.Type,
			})
		}
	}

	return diff
}

type Table struct {
	Name    string
	Columns Columns
	Version int64
}

//Return true if there is at least one column
func (t *Table) Exists() bool {
	return t != nil && len(t.Columns) > 0
}

// Diff calculates diff between current schema and another one.
// Return schema to add to current schema (for being equal) or empty if
// 1) another one is empty
// 2) all fields from another schema exist in current schema
// Return err if any column type was changed
func (t Table) Diff(another *Table) (*Table, error) {
	diff := &Table{Name: t.Name, Columns: Columns{}}

	if another == nil || len(another.Columns) == 0 {
		return diff, nil
	}

	for name, column := range another.Columns {
		if currentColumn, ok := t.Columns[name]; ok {
			//type was changed
			if currentColumn.Type != column.Type {
				return nil, fmt.Errorf("Unsupported column [%s] type changing from: %s to: %s", name, currentColumn.Type.String(), column.Type.String())
			}
		} else {
			diff.Columns[name] = column
		}
	}

	return diff, nil
}

type Column struct {
	Type typing.DataType
}
