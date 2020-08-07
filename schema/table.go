package schema

type DataType int

const (
	STRING DataType = iota
)

func (dt DataType) String() string {
	switch dt {
	default:
		return ""
	case STRING:
		return "STRING"
	}
}

type TableNameExtractFunction func(map[string]interface{}) (string, error)
type Columns map[string]Column

//Add all columns from other to current instance
func (c Columns) Merge(other Columns) {
	for name, column := range other {
		//TODO when we support several Column types (not only String) we need check if type was changed
		c[name] = column
	}
}

type Table struct {
	Name    string
	Columns Columns
}

//Return true if there is at least one column
func (t *Table) Exists() bool {
	return t != nil && len(t.Columns) > 0
}

// Diff calculates diff between current schema and another one.
// Assume that current schema exists (at least with empty columns)
// Return schema to add to current schema (for being equal) or empty if
// 1) another one is empty
// 2) all fields from another schema exist in current schema
func (t Table) Diff(another *Table) *Table {
	diff := &Table{Name: t.Name, Columns: Columns{}}

	if another == nil || len(another.Columns) == 0 {
		return diff
	}

	//not empty main schema => write only new columns to the result
	for columnName, columnType := range another.Columns {
		if _, ok := t.Columns[columnName]; !ok {
			//TODO add type check
			diff.Columns[columnName] = columnType
		}
	}

	return diff
}

type Column struct {
	Type DataType
}
