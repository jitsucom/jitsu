package adapters

import "reflect"

type Columns map[string]Column

type TableField struct {
	Field string      `json:"field,omitempty"`
	Type  string      `json:"type,omitempty"`
	Value interface{} `json:"value,omitempty"`
}

type Column struct {
	SqlType string
}

type Table struct {
	Name           string
	Columns        Columns
	PKFields       map[string]bool
	DeletePkFields bool
	Version        int64
}

//Return true if there is at least one column
func (t *Table) Exists() bool {
	if t == nil {
		return false
	}

	return len(t.Columns) > 0 || len(t.PKFields) > 0 || t.DeletePkFields
}

func (t *Table) GetPKFields() []string {
	var pkFields []string
	for pkField := range t.PKFields {
		pkFields = append(pkFields, pkField)
	}

	return pkFields
}

func (t *Table) GetPKFieldsMap() map[string]bool {
	pkFields := make(map[string]bool, len(t.PKFields))
	for name := range t.PKFields {
		pkFields[name] = true
	}

	return pkFields
}

// Diff calculates diff between current schema and another one.
// Return schema to add to current schema (for being equal) or empty if
// 1) another one is empty
// 2) all fields from another schema exist in current schema
// NOTE: Diff method doesn't take types into account
func (t Table) Diff(another *Table) *Table {
	diff := &Table{Name: t.Name, Columns: map[string]Column{}, PKFields: map[string]bool{}}

	if !another.Exists() {
		return diff
	}

	for name, column := range another.Columns {
		_, ok := t.Columns[name]
		if !ok {
			diff.Columns[name] = column
		}
	}

	if len(t.PKFields) > 0 && len(another.PKFields) == 0 {
		diff.DeletePkFields = true
	} else {
		if !reflect.DeepEqual(t.PKFields, another.PKFields) {
			diff.PKFields = another.PKFields
		}
	}

	return diff
}
