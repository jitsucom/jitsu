package sql

import (
	"strings"

	"github.com/jitsucom/bulker/bulkerlib/types"
	"github.com/jitsucom/bulker/jitsubase/jsonorder"
)

const BulkerManagedPkConstraintPrefix = "jitsu_pk_"

// Columns is a list of columns representation
type Columns = *jsonorder.OrderedMap[string, types.SQLColumn]

func NewColumns(defaultCapacity int) Columns {
	return jsonorder.NewOrderedMap[string, types.SQLColumn](defaultCapacity)
}

func NewColumnsFromMap(mp map[string]types.SQLColumn) Columns {
	m := jsonorder.NewOrderedMap[string, types.SQLColumn](len(mp))
	m.SetAllMap(mp)
	return m
}

func NewColumnsFromArrays(arr []jsonorder.El[string, types.SQLColumn]) Columns {
	m := jsonorder.NewOrderedMap[string, types.SQLColumn](len(arr))
	for _, a := range arr {
		m.Set(a.Key, a.Value)
	}
	return m
}

// TableField is a table column representation
type TableField struct {
	Field string `json:"field,omitempty"`
	Type  string `json:"type,omitempty"`
	Value any    `json:"value,omitempty"`
}

// Table is a dto for DWH Table representation
type Table struct {
	Name string
	// database or schema depending on warehouse
	Namespace string
	Temporary bool
	Cached    bool

	Columns         Columns
	PKFields        jsonorder.OrderedSet[string]
	PrimaryKeyName  string
	TimestampColumn string

	Partition DatePartition

	DeletePrimaryKeyNamed string
}

// Exists returns true if there is at least one column
func (t *Table) Exists() bool {
	if t == nil {
		return false
	}

	return (t.Columns != nil && t.Columns.Len() > 0) || t.PKFields.Size() > 0 || t.DeletePrimaryKeyNamed != ""
}

// ColumnNames return column names as array
func (t *Table) ColumnNames() []string {
	return t.Columns.Keys()
}

func (t *Table) ToArray() []types.SQLColumn {
	var columns []types.SQLColumn
	t.Columns.ForEach(func(key string, value types.SQLColumn) {
		columns = append(columns, value)
	})
	return columns
}

func (t *Table) MappedColumns(f func(string, types.SQLColumn) string) []string {
	columns := make([]string, 0, t.Columns.Len())
	for el := t.Columns.Front(); el != nil; el = el.Next() {
		columns = append(columns, f(el.Key, el.Value))
	}
	return columns
}

func (t *Table) MappedColumnNames(f func(string) string) []string {
	columns := make([]string, 0, t.Columns.Len())
	for el := t.Columns.Front(); el != nil; el = el.Next() {
		columns = append(columns, f(el.Key))
	}
	return columns
}

// CleanClone returns clone of current table w/o 'New' or 'Override' flags
func (t *Table) CleanClone() *Table {
	if t == nil {
		return nil
	}
	clonedColumns := NewColumns(t.Columns.Len())
	for el := t.Columns.Front(); el != nil; el = el.Next() {
		v := el.Value
		clonedColumns.Set(el.Key, types.SQLColumn{
			Type:     v.Type,
			DdlType:  v.DdlType,
			DataType: v.DataType,
		})
	}

	clonedPkFields := t.PKFields.Clone()

	return &Table{
		Namespace:             t.Namespace,
		Name:                  t.Name,
		Columns:               clonedColumns,
		PKFields:              clonedPkFields,
		PrimaryKeyName:        t.PrimaryKeyName,
		Temporary:             t.Temporary,
		TimestampColumn:       t.TimestampColumn,
		Partition:             t.Partition,
		Cached:                t.Cached,
		DeletePrimaryKeyNamed: t.DeletePrimaryKeyNamed,
	}
}

func (t *Table) CloneIfNeeded() *Table {
	if t == nil {
		return nil
	}
	if t.Cached {
		return t
	}
	return t.Clone()
}

func (t *Table) WithoutColumns() *Table {
	if t == nil {
		return nil
	}
	return t.clone(true)
}

func (t *Table) Clone() *Table {
	if t == nil {
		return nil
	}
	return t.clone(false)
}

// Clone returns clone of current table
func (t *Table) clone(omitColumns bool) *Table {
	var clonedColumns Columns
	if !omitColumns {
		clonedColumns = NewColumns(t.Columns.Len())
		for el := t.Columns.Front(); el != nil; el = el.Next() {
			v := el.Value
			clonedColumns.Set(el.Key, types.SQLColumn{
				Type:     v.Type,
				DdlType:  v.DdlType,
				DataType: v.DataType,
				New:      v.New,
				Override: v.Override,
			})
		}
	} else {
		clonedColumns = NewColumns(0)
	}

	clonedPkFields := t.PKFields.Clone()

	return &Table{
		Namespace:             t.Namespace,
		Name:                  t.Name,
		Columns:               clonedColumns,
		PKFields:              clonedPkFields,
		PrimaryKeyName:        t.PrimaryKeyName,
		Temporary:             t.Temporary,
		TimestampColumn:       t.TimestampColumn,
		Partition:             t.Partition,
		Cached:                t.Cached,
		DeletePrimaryKeyNamed: t.DeletePrimaryKeyNamed,
	}
}

// GetPKFields returns primary keys list
func (t *Table) GetPKFields() []string {
	return t.PKFields.ToSlice()
}

func (t *Table) GetPKFieldsSet() jsonorder.OrderedSet[string] {
	return t.PKFields
}

// Diff calculates diff between current schema and another one.
// Return schema to add to current schema (for being equal) or empty if
// 1) another one is empty
// 2) all fields from another schema exist in current schema
// NOTE: Diff method doesn't take types into account
func (t *Table) Diff(another *Table) *Table {
	diff := &Table{Name: t.Name, Namespace: t.Namespace, Columns: NewColumns(0), PKFields: jsonorder.NewOrderedSet[string]()}

	if !another.Exists() {
		return diff
	}

	for el := another.Columns.Front(); el != nil; el = el.Next() {
		name := el.Key
		_, ok := t.Columns.Get(name)
		if !ok {
			diff.Columns.Set(name, el.Value)
		}
	}

	classicPrimaryKeyName := t.Namespace + "_" + t.Name + "_pk"
	jitsuManagedPk := strings.HasPrefix(strings.ToLower(t.PrimaryKeyName), BulkerManagedPkConstraintPrefix) || (t.PrimaryKeyName == classicPrimaryKeyName && t.PKFields.Size() == 1 && t.PKFields.Contains("eventn_ctx_event_id"))
	//check if primary key is maintained by Jitsu (for Postgres and Redshift)
	if t.PrimaryKeyName != "" && !jitsuManagedPk {
		//primary key isn't maintained by Jitsu: do nothing
		return diff
	}

	//primary keys logic
	if t.PKFields.Size() > 0 {
		if !t.PKFields.Equals(another.PKFields) {
			//re-create or delete if another.PKFields is empty
			diff.DeletePrimaryKeyNamed = t.PrimaryKeyName
			diff.PKFields = another.PKFields
		}
	} else if another.PKFields.Size() > 0 {
		//create
		diff.PKFields = another.PKFields
	}

	return diff
}

// samePatch reports whether two diffs describe the same change - the same columns to
// add and the same primary key work. Used to tell a stale view of the table (worth
// re-reading and patching again) from a patch the database rejects on its merits.
func (t *Table) samePatch(another *Table) bool {
	if t.ColumnsCount() != another.ColumnsCount() {
		return false
	}
	for el := t.Columns.Front(); el != nil; el = el.Next() {
		column, ok := another.Columns.Get(el.Key)
		if !ok || column.Type != el.Value.Type {
			return false
		}
	}
	return t.DeletePrimaryKeyNamed == another.DeletePrimaryKeyNamed && t.PKFields.Equals(another.PKFields)
}

func (t *Table) ToSimpleMap() *jsonorder.OrderedMap[string, any] {
	simple := jsonorder.NewOrderedMap[string, any](t.ColumnsCount())
	for el := t.Columns.Front(); el != nil; el = el.Next() {
		simple.Set(el.Key, el.Value.Type)
	}
	return simple
}

func (t *Table) ColumnsCount() int {
	if t == nil {
		return 0
	}
	return t.Columns.Len()
}
