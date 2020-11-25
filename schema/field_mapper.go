package schema

import (
	"fmt"
	"github.com/jitsucom/eventnative/jsonutils"
	"github.com/jitsucom/eventnative/typing"
	"strings"
)

type Mapper interface {
	Map(object map[string]interface{}) (map[string]interface{}, error)
}

type FieldMappingType string

const (
	Default FieldMappingType = ""
	Strict  FieldMappingType = "strict"
)

var systemFields = []string{"_timestamp", "eventn_ctx_event_id", "src"}

func (f FieldMappingType) String() string {
	if f == Strict {
		return "Strict"
	} else {
		return "Default"
	}
}

type FieldMapper struct {
	rules []*MappingRule
}

type StrictFieldMapper struct {
	rules []*MappingRule
}

type DummyMapper struct{}

type MappingRule struct {
	source      *jsonutils.JsonPath
	destination *jsonutils.JsonPath
}

//NewFieldMapper return FieldMapper, fields to typecast and err
func NewFieldMapper(mappingType FieldMappingType, mappings []string) (Mapper, map[string]typing.DataType, error) {
	if len(mappings) == 0 {
		return &DummyMapper{}, nil, nil
	}

	var rules []*MappingRule
	fieldsToCast := map[string]typing.DataType{}
	for _, mapping := range mappings {
		mappingWithoutSpaces := strings.ReplaceAll(mapping, " ", "")
		parts := strings.Split(mappingWithoutSpaces, "->")

		if len(parts) != 2 {
			return nil, nil, fmt.Errorf("Malformed data mapping [%s]. Use format: /field1/subfield1 -> /field2/subfield2", mapping)
		}

		source := parts[0]
		destination := parts[1]

		if source == "" {
			return nil, nil, fmt.Errorf("Malformed data mapping [%s]. Source part before '->' can't be empty", mapping)
		}

		//without type casting
		if !strings.Contains(destination, ")") {
			rules = append(rules, &MappingRule{
				source:      jsonutils.NewJsonPath(source),
				destination: jsonutils.NewJsonPath(destination),
			})
			continue
		}

		//parse type casting
		destParts := strings.Split(destination, ")")
		if len(destParts) != 2 || (len(destParts) == 1 && destParts[0] == "") {
			return nil, nil, fmt.Errorf("Malformed cast statement in data mapping [%s]. Use format: /field1/subfield1 -> (integer) /field2/subfield2", mapping)
		}

		// /key1/key2 -> key1_key2
		formattedDestination := strings.ReplaceAll(jsonutils.FormatPrefixSuffix(destParts[1]), "/", "_")

		castType := strings.ReplaceAll(destParts[0], "(", "")
		dataType, err := typing.TypeFromString(castType)
		if err != nil {
			return nil, nil, fmt.Errorf("Malformed cast type in data mapping [%s]: %v. Available types: integer, double, string, timestamp", mapping, err)
		}

		fieldsToCast[formattedDestination] = dataType
		rules = append(rules, &MappingRule{
			source:      jsonutils.NewJsonPath(source),
			destination: jsonutils.NewJsonPath(destParts[1]),
		})
	}
	if mappingType == Strict {
		return &StrictFieldMapper{rules: rules}, fieldsToCast, nil
	}
	return &FieldMapper{rules: rules}, fieldsToCast, nil
}

//Map changes input object and applies deletes and mappings
func (fm FieldMapper) Map(object map[string]interface{}) (map[string]interface{}, error) {
	applyMapping(object, object, fm.rules)

	return object, nil
}

func (fm StrictFieldMapper) Map(object map[string]interface{}) (map[string]interface{}, error) {
	mappedObject := make(map[string]interface{})

	applyMapping(object, mappedObject, fm.rules)

	for _, field := range systemFields {
		if val, ok := object[field]; ok {
			mappedObject[field] = val
		}
	}
	return mappedObject, nil
}

//Return object as is
func (DummyMapper) Map(object map[string]interface{}) (map[string]interface{}, error) {
	return object, nil
}

func applyMapping(sourceObj, destinationObj map[string]interface{}, rules []*MappingRule) {
	for _, rule := range rules {
		value, ok := rule.source.GetAndRemove(sourceObj)
		if ok {
			//handle delete rules
			if rule.destination.IsEmpty() {
				continue
			}

			ok := rule.destination.Set(destinationObj, value)
			if !ok {
				//key wasn't set into destination object
				//set as is
				rule.source.Set(destinationObj, value)
			}
		}
	}
}
