package schema

import (
	"errors"
	"fmt"
	"strings"

	"github.com/jitsucom/jitsu/server/config"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/jsonutils"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/typing"
)

type FieldMapper struct {
	rules              []*MappingRule
	keepUnmappedFields bool
}

type DummyMapper struct{}

type MappingRule struct {
	source      jsonutils.JSONPath
	destination jsonutils.JSONPath
	action      string
	value       interface{}
}

//NewFieldMapper return FieldMapper, sql typecast and err
func NewFieldMapper(newStyleMappings *config.Mapping) (events.Mapper, typing.SQLTypes, error) {
	if newStyleMappings == nil || len(newStyleMappings.Fields) == 0 {
		return &DummyMapper{}, typing.SQLTypes{}, nil
	}

	var rules []*MappingRule
	sqlTypes := typing.SQLTypes{}

	keepUnmappedFields := true
	if newStyleMappings.KeepUnmapped != nil {
		keepUnmappedFields = *newStyleMappings.KeepUnmapped
	}

	for _, mapping := range newStyleMappings.Fields {
		err := mapping.Validate()
		if err != nil {
			return nil, nil, fmt.Errorf("Mapping rule validation error: %v", err)
		}

		rule := &MappingRule{
			source:      jsonutils.NewJSONPath(mapping.Src),
			destination: jsonutils.NewJSONPath(mapping.Dst),
			action:      mapping.Action,
			value:       mapping.Value,
		}
		rules = append(rules, rule)

		//collect sql typecasts
		if mapping.Type != "" {
			if mapping.ColumnType == "" {
				mapping.ColumnType = mapping.Type
			}
			sqlTypes[rule.destination.FieldName()] = typing.SQLColumn{
				Type:       mapping.Type,
				ColumnType: mapping.ColumnType,
			}
		}
	}

	return &FieldMapper{rules: rules, keepUnmappedFields: keepUnmappedFields}, sqlTypes, nil
}

//Map changes input object and applies deletes and mappings
func (fm *FieldMapper) Map(object map[string]interface{}) (map[string]interface{}, error) {
	mappedObject := make(map[string]interface{})

	fieldToRemove, err := applyMapping(object, mappedObject, fm.rules)
	if err != nil {
		return nil, err
	}

	//return only mapped fields
	if !fm.keepUnmappedFields {
		//remove fields with action REMOVE
		for _, field := range fieldToRemove {
			field.GetAndRemove(mappedObject)
		}
		return mappedObject, nil
	}

	//enrich result with unmapped fields + mapped fields
	result := make(map[string]interface{})
	for k, v := range object {
		result[k] = v
	}

	for k, v := range mappedObject {
		result[k] = v
	}

	//remove fields with action REMOVE
	for _, field := range fieldToRemove {
		field.GetAndRemove(result)
	}

	return result, nil

}

//Map returns object as is
func (DummyMapper) Map(object map[string]interface{}) (map[string]interface{}, error) {
	return object, nil
}

func applyMapping(sourceObj, destinationObj map[string]interface{}, rules []*MappingRule) ([]jsonutils.JSONPath, error) {
	var fieldsToRemoveAfterMove []jsonutils.JSONPath
	var fieldsToRemove []jsonutils.JSONPath
	for _, rule := range rules {
		switch rule.action {
		case config.REMOVE:
			fieldsToRemove = append(fieldsToRemove, rule.source)
		case config.MOVE:
			value, ok := rule.source.Get(sourceObj)
			if ok {
				err := rule.destination.Set(destinationObj, value)
				if err != nil {
					return nil, err
				}

				fieldsToRemoveAfterMove = append(fieldsToRemoveAfterMove, rule.source)
			}
		case config.CAST:
			//will be handled in adapters
		case config.CONSTANT:
			err := rule.destination.Set(destinationObj, rule.value)
			if err != nil {
				return nil, err
			}
		default:
			msg := fmt.Sprintf("Unknown mapping type action: [%s]", rule.action)
			logging.SystemError(msg)
			return nil, errors.New(msg)
		}
	}

	for _, fieldToRemoveAfterMove := range fieldsToRemoveAfterMove {
		fieldToRemoveAfterMove.GetAndRemove(sourceObj)
	}

	return fieldsToRemove, nil
}

//ConvertOldMappings converts old style mappings into new style
//return new style mappings or error
func ConvertOldMappings(mappingType config.FieldMappingType, oldStyleMappings []string) (*config.Mapping, error) {
	var mappingFields []config.MappingField
	for _, mapping := range oldStyleMappings {
		mappingWithoutSpaces := strings.ReplaceAll(mapping, " ", "")
		parts := strings.Split(mappingWithoutSpaces, "->")

		if len(parts) != 2 {
			return nil, fmt.Errorf("Malformed data mapping [%s]. Use format: /field1/subfield1 -> /field2/subfield2", mapping)
		}

		source := parts[0]
		destination := strings.TrimSpace(parts[1])

		if source == "" {
			return nil, fmt.Errorf("Malformed data mapping [%s]. Source part before '->' can't be empty", mapping)
		}

		mf := config.MappingField{Src: source}
		if destination == "" {
			mf.Action = config.REMOVE
		} else {
			mf.Action = config.MOVE

			//with type casting
			if strings.Contains(destination, ")") {
				//parse type casting
				destParts := strings.Split(destination, ")")
				if len(destParts) != 2 || (len(destParts) == 1 && destParts[0] == "") {
					return nil, fmt.Errorf("Malformed cast statement in data mapping [%s]. Use format: /field1/subfield1 -> (integer) /field2/subfield2", mapping)
				}

				castType := strings.ReplaceAll(destParts[0], "(", "")

				mf.Dst = strings.TrimSpace(destParts[1])
				mf.Type = strings.TrimSpace(castType)
			} else {
				//without
				mf.Dst = destination
			}
		}

		mappingFields = append(mappingFields, mf)
	}

	keepUnmapped := mappingType == config.Default

	return &config.Mapping{
		KeepUnmapped: &keepUnmapped,
		Fields:       mappingFields,
	}, nil
}
