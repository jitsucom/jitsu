package schema

import (
	"fmt"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/typing"
	"reflect"
)

type TableNameExtractFunction func(map[string]interface{}) (string, error)
type Columns map[string]Column

//Merge add all columns from other to current instance
//wipe column.type if a new one was added
func (c Columns) Merge(other Columns) {
	for otherName, otherColumn := range other {
		if currentColumn, ok := c[otherName]; ok {
			//add new type occurrences
			//wipe column.type if new type was added
			for t := range otherColumn.typeOccurrence {
				if _, ok := currentColumn.typeOccurrence[t]; !ok {
					currentColumn.typeOccurrence[t] = true
					currentColumn.dataType = nil
					c[otherName] = currentColumn
				}
			}
		} else {
			c[otherName] = otherColumn
		}
	}
}

//Header return column names as a string slice
func (c Columns) Header() (header []string) {
	for columnName := range c {
		header = append(header, columnName)
	}
	return
}

type Table struct {
	Name     string
	Columns  Columns
	PKFields map[string]bool
	Version  int64
}

//Return true if there is at least one column
func (t *Table) Exists() bool {
	return t != nil && len(t.Columns) > 0
}

// Diff calculates diff between current schema and another one.
// Return schema to add to current schema (for being equal) or empty if
// 1) another one is empty
// 2) all fields from another schema exist in current schema
// Return err if another newType can't be cast to current type (column type changing case)
func (t Table) Diff(another *Table) (*Table, error) {
	diff := &Table{Name: t.Name, Columns: Columns{}}

	if another == nil || len(another.Columns) == 0 {
		return diff, nil
	}

	for name, column := range another.Columns {
		if currentColumn, ok := t.Columns[name]; ok {
			if !typing.IsConvertible(column.GetType(), currentColumn.GetType()) {
				return nil, fmt.Errorf("Unsupported column [%s] type changing from: %s to: %s", name, column.GetType().String(), currentColumn.GetType().String())
			}
		} else {
			diff.Columns[name] = column
		}
	}
	return diff, nil
}

func (t Table) Serialize(object map[string]interface{}) (string, error) {
	for name, value := range object {
		column, ok := t.Columns[name]
		if !ok {
			return "", fmt
		}
		col.GetType()
	}
}

func (t Table) PrimaryKeyFieldsEqual(another *Table) bool {
	return reflect.DeepEqual(t.PKFields, another.PKFields)
}

type PKFieldsPatch struct {
	PKFields map[string]bool
	Remove   bool
}

func NewPkFieldsPatch(oldSchema *Table, newSchema *Table) *PKFieldsPatch {
	fieldsPatch := map[string]bool{}
	if !oldSchema.PrimaryKeyFieldsEqual(newSchema) {
		fieldsPatch = newSchema.PKFields
	}
	removeKey := false
	if len(oldSchema.PKFields) > 0 && len(newSchema.PKFields) == 0 {
		removeKey = true
	}
	return &PKFieldsPatch{PKFields: fieldsPatch, Remove: removeKey}
}

// Return true if there is at least one field as a part of primary key
func (p *PKFieldsPatch) Exists() bool {
	return len(p.PKFields) > 0 || p.Remove
}

func (p *PKFieldsPatch) ToFieldsArray() []string {
	var fieldsList []string
	for field, isKeyField := range p.PKFields {
		if isKeyField {
			fieldsList = append(fieldsList, field)
		}
	}
	return fieldsList
}

func PkToFieldsArray(pkFields map[string]bool) []string {
	var fieldsList []string
	for field, isKeyField := range pkFields {
		if isKeyField {
			fieldsList = append(fieldsList, field)
		}
	}
	return fieldsList
}

type Column struct {
	dataType       *typing.DataType
	typeOccurrence map[typing.DataType]bool
}

func NewColumn(t typing.DataType) Column {
	return Column{
		dataType:       &t,
		typeOccurrence: map[typing.DataType]bool{t: true},
	}
}

//GetType get column type based on occurrence in one file
//lazily get common ancestor type (typing.GetCommonAncestorType)
func (c Column) GetType() typing.DataType {
	if c.dataType != nil {
		return *c.dataType
	}

	var types []typing.DataType
	for t := range c.typeOccurrence {
		types = append(types, t)
	}

	if len(types) == 0 {
		logging.SystemError("Column typeOccurrence can't be empty")
		return typing.UNKNOWN
	}

	common := types[0]
	for i := 1; i < len(types); i++ {
		common = typing.GetCommonAncestorType(common, types[i])
	}

	//put result to dataType (it will be wiped(in Merge) if a new type is added)
	c.dataType = &common
	return common
}

type Record struct {
	Field string      `json:"field,omitempty"`
	Type  string      `json:"type,omitempty"`
	Value interface{} `json:"value,omitempty"`
}
