package schema

import (
	"fmt"
	"github.com/jitsucom/eventnative/typing"
)

type TypeResolver interface {
	Resolve(map[string]interface{}) (Fields, error)
}

type DummyTypeResolver struct {
}

func NewDummyTypeResolver() *DummyTypeResolver {
	return &DummyTypeResolver{}
}

//Resolve return one dummy field and Fields becomes not empty. (it is used in Facebook destination)
func (dtr *DummyTypeResolver) Resolve(object map[string]interface{}) (Fields, error) {
	return Fields{"dummy": NewField(typing.UNKNOWN)}, nil
}

type TypeResolverImpl struct {
}

func NewTypeResolver() *TypeResolverImpl {
	return &TypeResolverImpl{}
}

//Resolve return Fields representation of input object
//apply default typecast and define column types
//reformat from json.Number into int64 or float64 and put back
func (tr *TypeResolverImpl) Resolve(object map[string]interface{}) (Fields, error) {
	fields := Fields{}
	//apply default typecast and define column types
	for k, v := range object {
		//reformat from json.Number into int64 or float64 and put back
		v = typing.ReformatValue(v)
		object[k] = v
		//value type
		resultColumnType, err := typing.TypeFromValue(v)
		if err != nil {
			return nil, fmt.Errorf("Error getting type of field [%s]: %v", k, err)
		}

		//default typecast
		if defaultType, ok := typing.DefaultTypes[k]; ok {
			converted, err := typing.Convert(defaultType, v)
			if err != nil {
				return nil, fmt.Errorf("Error default converting field [%s]: %v", k, err)
			}

			resultColumnType = defaultType
			object[k] = converted
		}

		fields[k] = NewField(resultColumnType)
	}

	return fields, nil
}
