package schema

import (
	"fmt"
	"github.com/jitsucom/jitsu/server/events"
)

type MappingStep struct {
	fieldMapper       events.Mapper
	flattener         Flattener
	typeResolver      TypeResolver
	dummyTypeResolver TypeResolver
}

func NewMappingStep(fieldMapper events.Mapper, flattener Flattener, typeResolver TypeResolver) *MappingStep {
	return &MappingStep{
		fieldMapper:       fieldMapper,
		flattener:         flattener,
		typeResolver:      typeResolver,
		dummyTypeResolver: NewDummyTypeResolver(),
	}
}

//Execute
//1. applies mappings
//2. flattens object
//3. applies default typecasts
func (ms *MappingStep) Execute(tableName string, object map[string]interface{}, flatten bool) (*BatchHeader, map[string]interface{}, error) {
	mappedObject, err := ms.fieldMapper.Map(object)
	if err != nil {
		return nil, nil, fmt.Errorf("Error mapping object: %v", err)
	}

	if !flatten {
		fields, _ := ms.dummyTypeResolver.Resolve(mappedObject)
		return &BatchHeader{TableName: tableName, Fields: fields}, mappedObject, nil
	}

	flatObject, err := ms.flattener.FlattenObject(mappedObject)
	if err != nil {
		return nil, nil, err
	}

	fields, err := ms.typeResolver.Resolve(flatObject)
	if err != nil {
		return nil, nil, err
	}

	return &BatchHeader{TableName: tableName, Fields: fields}, flatObject, nil
}
