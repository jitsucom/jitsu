package schema

import (
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/typing"
)

type Fields map[string]Field

//BatchHeader is the schema result of parsing JSON objects
type BatchHeader struct {
	TableName string
	Fields    Fields
}

//Exists returns true if there is at least one field
func (bh *BatchHeader) Exists() bool {
	return bh != nil && len(bh.Fields) > 0
}

//Merge add all fields from other to current instance
//wipe field.type if a new one was added
func (f Fields) Merge(other Fields) {
	for otherName, otherField := range other {
		if currentField, ok := f[otherName]; ok {
			//add new type occurrences
			//wipe field.type if new type was added
			for t := range otherField.typeOccurrence {
				if _, ok := currentField.typeOccurrence[t]; !ok {
					currentField.typeOccurrence[t] = true
					currentField.dataType = nil
					f[otherName] = currentField
				}
			}
		} else {
			f[otherName] = otherField
		}
	}
}

//Clone copies fields into a new Fields object
func (f Fields) Clone() Fields {
	clone := Fields{}

	for fieldName, fieldPayload := range f {
		clonedTypeOccurence := map[typing.DataType]bool{}
		for typeName, occurrence := range fieldPayload.typeOccurrence {
			clonedTypeOccurence[typeName] = occurrence
		}

		clone[fieldName] = Field{
			dataType:       fieldPayload.dataType,
			typeOccurrence: clonedTypeOccurence,
		}
	}

	return clone
}

//OverrideTypes check if field exists in other then put its type
func (f Fields) OverrideTypes(other Fields) {
	for otherName, otherField := range other {
		if currentField, ok := f[otherName]; ok {
			//override type occurrences
			currentField.typeOccurrence = otherField.typeOccurrence
			currentField.dataType = otherField.dataType
		}
	}
}

//Add all new fields from other to current instance
//if field exists - skip it
func (f Fields) Add(other Fields) {
	for otherName, otherField := range other {
		if _, ok := f[otherName]; !ok {
			f[otherName] = otherField
		}
	}
}

//Header return fields names as a string slice
func (f Fields) Header() (header []string) {
	for fieldName := range f {
		header = append(header, fieldName)
	}
	return
}

//Field is a data type holder with occurrences
type Field struct {
	dataType       *typing.DataType
	typeOccurrence map[typing.DataType]bool
}

//NewField return Field instance
func NewField(t typing.DataType) Field {
	return Field{
		dataType:       &t,
		typeOccurrence: map[typing.DataType]bool{t: true},
	}
}

//GetType get field type based on occurrence in one file
//lazily get common ancestor type (typing.GetCommonAncestorType)
func (f Field) GetType() typing.DataType {
	if f.dataType != nil {
		return *f.dataType
	}

	var types []typing.DataType
	for t := range f.typeOccurrence {
		types = append(types, t)
	}

	if len(types) == 0 {
		logging.SystemError("Field typeOccurrence can't be empty")
		return typing.UNKNOWN
	}

	common := types[0]
	for i := 1; i < len(types); i++ {
		common = typing.GetCommonAncestorType(common, types[i])
	}

	//put result to dataType (it will be wiped(in Merge) if a new type is added)
	f.dataType = &common
	return common
}
