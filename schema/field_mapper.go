package schema

import (
	"fmt"
	"github.com/ksensehq/eventnative/typing"
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
	// "/key1/key2/key3 -> /key4/key5"
	//[key1, key2, key3]
	source []string
	//[key4, key5]
	destination []string
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
			destinationParts := strings.Split(formatPrefixSuffix(destination), "/")
			if len(destinationParts) == 1 && destinationParts[0] == "" {
				destinationParts = []string{}
			}
			rules = append(rules, &MappingRule{
				source:      strings.Split(formatPrefixSuffix(source), "/"),
				destination: destinationParts,
			})
			continue
		}

		//parse type casting
		destParts := strings.Split(destination, ")")
		if len(destParts) != 2 || (len(destParts) == 1 && destParts[0] == "") {
			return nil, nil, fmt.Errorf("Malformed cast statement in data mapping [%s]. Use format: /field1/subfield1 -> (integer) /field2/subfield2", mapping)
		}

		// /key1/key2 -> []string{key1, key2}
		destinationArr := strings.Split(formatPrefixSuffix(destParts[1]), "/")
		// []string{key1, key2} -> key1_key2
		formattedDestination := strings.Join(destinationArr, "_")

		castType := strings.ReplaceAll(destParts[0], "(", "")
		dataType, err := typing.TypeFromString(castType)
		if err != nil {
			return nil, nil, fmt.Errorf("Malformed cast type in data mapping [%s]: %v. Available types: integer, double, string, timestamp", mapping, err)
		}

		fieldsToCast[formattedDestination] = dataType
		rules = append(rules, &MappingRule{
			source:      strings.Split(formatPrefixSuffix(source), "/"),
			destination: destinationArr,
		})
	}
	if mappingType == Strict {
		return &StrictFieldMapper{rules: rules}, fieldsToCast, nil
	}
	return &FieldMapper{rules: rules}, fieldsToCast, nil
}

//Map copy input object with applied deletes and mappings
func (fm FieldMapper) Map(object map[string]interface{}) (map[string]interface{}, error) {
	mappedObject := copyMap(object)

	for _, rule := range fm.rules {
		//dive into source inner and map last key from mapping '/key1/../lastkey'
		sourceInner := mappedObject
		destInner := mappedObject
		for i := 0; i < len(rule.source); i++ {
			sourceKey := rule.source[i]
			if i == len(rule.source)-1 {
				//check if dest is empty => handle delete
				if len(rule.destination) == 0 {
					delete(sourceInner, sourceKey)
					break
				}
				applyRule(sourceInner, destInner, sourceKey, rule)
				break
			}
			//dive
			if sub, ok := sourceInner[sourceKey]; ok {
				if subMap, ok := sub.(map[string]interface{}); ok {
					sourceInner = subMap
					continue
				}
			}
			break
		}
	}
	return mappedObject, nil
}

func (fm StrictFieldMapper) Map(object map[string]interface{}) (map[string]interface{}, error) {
	mappedObject := make(map[string]interface{})

	for _, rule := range fm.rules {
		//dive into source inner and map last key from mapping '/key1/../lastkey'
		sourceInner := object
		destInner := mappedObject
		for i := 0; i < len(rule.source); i++ {
			sourceKey := rule.source[i]
			if i == len(rule.source)-1 {
				applyRule(sourceInner, destInner, sourceKey, rule)
				break
			}
			//dive
			if sub, ok := sourceInner[sourceKey]; ok {
				if subMap, ok := sub.(map[string]interface{}); ok {
					sourceInner = subMap
					continue
				}
			}
			break
		}
	}
	return mappedObject, nil
}

//Return object as is
func (DummyMapper) Map(object map[string]interface{}) (map[string]interface{}, error) {
	return object, nil
}

func applyRule(sourceInner map[string]interface{}, destInner map[string]interface{}, sourceKey string, rule *MappingRule) {
	sourceNodeToTransfer, ok := sourceInner[sourceKey]
	//source node doesn't exist
	if !ok {
		return
	}
	//dive into dest inner and put to last last key from mapping '/key2/../lastkey2'
	for j := 0; j < len(rule.destination); j++ {
		destKey := rule.destination[j]
		if j == len(rule.destination)-1 {
			destInner[destKey] = sourceNodeToTransfer
			delete(sourceInner, sourceKey)
			break
		}

		//dive or create
		if sub, ok := destInner[destKey]; ok {
			if subMap, ok := sub.(map[string]interface{}); ok {
				destInner = subMap
			} else {
				//node isn't object node
				break
			}
		} else {
			subMap := map[string]interface{}{}
			destInner[destKey] = subMap
			destInner = subMap
		}
	}
}

func formatPrefixSuffix(key string) string {
	if strings.HasPrefix(key, "/") {
		key = key[1:]
	}
	if strings.HasSuffix(key, "/") {
		key = key[:len(key)-1]
	}
	return key
}

func copyMap(m map[string]interface{}) map[string]interface{} {
	cp := make(map[string]interface{})
	for k, v := range m {
		vm, ok := v.(map[string]interface{})
		if ok {
			cp[k] = copyMap(vm)
		} else {
			cp[k] = v
		}
	}

	return cp
}
