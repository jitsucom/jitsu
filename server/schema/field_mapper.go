package schema

import (
	"errors"
	"fmt"
	"github.com/jitsucom/eventnative/server/jsonutils"
	"github.com/jitsucom/eventnative/server/logging"
	"strings"
)

var SystemFields = []string{"_timestamp", "eventn_ctx_event_id", "src"}

type Mapper interface {
	Map(object map[string]interface{}) (map[string]interface{}, error)
}

type FieldMapper struct {
	rules              []*MappingRule
	keepUnmappedFields bool
}

type DummyMapper struct{}

type MappingRule struct {
	source      *jsonutils.JsonPath
	destination *jsonutils.JsonPath
	action      string
	value       interface{}
}

//NewFieldMapper return FieldMapper, sql typecast and err
func NewFieldMapper(oldStyleMappingType FieldMappingType, oldStyleMappings []string, newStyleMappings *Mapping) (Mapper, map[string]string, error) {
	if len(oldStyleMappings) == 0 && (newStyleMappings == nil || len(newStyleMappings.Fields) == 0) {
		return &DummyMapper{}, map[string]string{}, nil
	}

	var rules []*MappingRule
	sqlTypeCasts := map[string]string{}

	//** new style **
	if newStyleMappings != nil && len(newStyleMappings.Fields) > 0 {
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
				source:      jsonutils.NewJsonPath(mapping.Src),
				destination: jsonutils.NewJsonPath(mapping.Dst),
				action:      mapping.Action,
				value:       mapping.Value,
			}
			rules = append(rules, rule)

			//collect sql typecasts
			if mapping.Type != "" {
				sqlTypeCasts[rule.destination.FieldName()] = mapping.Type
			}
		}

		return &FieldMapper{rules: rules, keepUnmappedFields: keepUnmappedFields}, sqlTypeCasts, nil
	}

	//** old style **
	for _, mapping := range oldStyleMappings {
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
			rule := &MappingRule{
				source:      jsonutils.NewJsonPath(source),
				destination: jsonutils.NewJsonPath(destination),
			}
			if rule.destination.IsEmpty() {
				rule.action = REMOVE
			} else {
				rule.action = MOVE
			}

			rules = append(rules, rule)
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

		//old type: integer, double
		sqlTypeCasts[formattedDestination] = castType
		rules = append(rules, &MappingRule{
			source:      jsonutils.NewJsonPath(source),
			destination: jsonutils.NewJsonPath(destParts[1]),
			action:      MOVE,
		})
	}

	return &FieldMapper{rules: rules, keepUnmappedFields: oldStyleMappingType == Default}, sqlTypeCasts, nil
}

//Map changes input object and applies deletes and mappings
func (fm *FieldMapper) Map(object map[string]interface{}) (map[string]interface{}, error) {
	mappedObject := object
	if !fm.keepUnmappedFields {
		mappedObject = make(map[string]interface{})
	}

	err := applyMapping(object, mappedObject, fm.rules)
	if err != nil {
		return nil, err
	}

	if !fm.keepUnmappedFields {
		for _, field := range SystemFields {
			if val, ok := object[field]; ok {
				mappedObject[field] = val
			}
		}
	}
	return mappedObject, nil
}

//Return object as is
func (DummyMapper) Map(object map[string]interface{}) (map[string]interface{}, error) {
	return object, nil
}

func applyMapping(sourceObj, destinationObj map[string]interface{}, rules []*MappingRule) error {
	var fieldsToRemove []*jsonutils.JsonPath
	for _, rule := range rules {
		switch rule.action {
		case REMOVE:
			fieldsToRemove = append(fieldsToRemove, rule.source)
		case MOVE:
			value, ok := rule.source.Get(sourceObj)
			if ok {
				err := rule.destination.Set(destinationObj, value)
				if err != nil {
					return err
				}

				fieldsToRemove = append(fieldsToRemove, rule.source)
			}
		case CAST:
			//will be handled in adapters
		case CONSTANT:
			err := rule.destination.Set(destinationObj, rule.value)
			if err != nil {
				return err
			}
		default:
			msg := fmt.Sprintf("Unknown mapping type action: [%s]", rule.action)
			logging.SystemError(msg)
			return errors.New(msg)
		}
	}

	for _, fieldToRemove := range fieldsToRemove {
		fieldToRemove.GetAndRemove(sourceObj)
	}

	return nil
}
