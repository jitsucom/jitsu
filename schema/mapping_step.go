package schema

import (
	"fmt"
	"github.com/jitsucom/eventnative/typing"
)

type MappingStep struct {
	fieldMapper Mapper
	flattener   *Flattener
}

func NewMappingStep(fieldMapper Mapper, flattener *Flattener) *MappingStep {
	return &MappingStep{
		fieldMapper: fieldMapper,
		flattener:   flattener,
	}
}

//1. apply mappings
//2. flatten object
//3. apply default typecasts
func (ms *MappingStep) Execute(tableName string, object map[string]interface{}) (*BatchHeader, map[string]interface{}, error) {
	batchHeader := &BatchHeader{TableName: tableName, Fields: Fields{}}

	mappedObject, err := ms.fieldMapper.Map(object)
	if err != nil {
		return nil, nil, fmt.Errorf("Error mapping object: %v", err)
	}

	flatObject, err := ms.flattener.FlattenObject(mappedObject)
	if err != nil {
		return nil, nil, err
	}

	//apply default typecast and define column types
	for k, v := range flatObject {
		//reformat from json.Number into int64 or float64 and put back
		v = typing.ReformatValue(v)
		flatObject[k] = v
		//value type
		resultColumnType, err := typing.TypeFromValue(v)
		if err != nil {
			return nil, nil, fmt.Errorf("Error getting type of field [%s]: %v", k, err)
		}

		//default typecast
		if defaultType, ok := typing.DefaultTypes[k]; ok {
			converted, err := typing.Convert(defaultType, v)
			if err != nil {
				return nil, nil, fmt.Errorf("Error default converting field [%s]: %v", k, err)
			}

			resultColumnType = defaultType
			flatObject[k] = converted
		}

		batchHeader.Fields[k] = NewField(resultColumnType)
	}

	return batchHeader, flatObject, nil
}
