package schema

import (
	"fmt"
	"github.com/ksensehq/eventnative/typing"
	"log"
	"strings"
)

type Mapper interface {
	Map(object map[string]interface{}) (map[string]interface{}, error)
	ApplyDelete(object map[string]interface{}) map[string]interface{}
}

type FieldMapper struct {
	//src: key1_key2, dest: key3_key4
	rules []*MappingRule
	// /key1/key2
	pathsToDelete []string
}

type DummyMapper struct{}

type MappingRule struct {
	source      string
	destination string
}

//NewFieldMapper return FieldMapper, fields to typecast and err
func NewFieldMapper(mappings []string) (Mapper, map[string]typing.DataType, error) {
	if len(mappings) == 0 {
		return &DummyMapper{}, nil, nil
	}

	var rules []*MappingRule
	var pathsToDelete []string
	fieldsToCast := map[string]typing.DataType{}
	for _, mapping := range mappings {
		mappingWithoutSpaces := strings.ReplaceAll(mapping, " ", "")
		parts := strings.Split(mappingWithoutSpaces, "->")

		if len(parts) != 2 {
			return nil, nil, fmt.Errorf("Malformed data mapping [%s]. Use format: /field1/subfield1 -> /field2/subfield2", mapping)
		}

		source := parts[0]
		destination := parts[1]

		//mappings like: '/key1 -> '
		if destination == "" {
			pathsToDelete = append(pathsToDelete, formatPrefixSuffix(source))
			continue
		}

		//without type casting
		if !strings.Contains(destination, ")") {
			rules = append(rules, &MappingRule{
				source:      formatKey(source),
				destination: formatKey(destination),
			})
			continue
		}

		//parse type casting
		destParts := strings.Split(destination, ")")
		if len(destParts) != 2 {
			return nil, nil, fmt.Errorf("Malformed cast statement in data mapping [%s]. Use format: /field1/subfield1 -> (integer) /field2/subfield2", mapping)
		}

		formattedDestination := formatKey(destParts[1])

		castType := strings.ReplaceAll(destParts[0], "(", "")
		dataType, err := typing.TypeFromString(castType)
		if err != nil {
			return nil, nil, fmt.Errorf("Malformed cast type in data mapping [%s]: %v. Available types: integer, double, string, timestamp", mapping, err)
		}

		fieldsToCast[formattedDestination] = dataType
		rules = append(rules, &MappingRule{
			source:      formatKey(source),
			destination: formattedDestination,
		})
	}

	log.Println("Configured field mapping rules:")
	for _, m := range mappings {
		log.Println(m)
	}

	return &FieldMapper{rules: rules, pathsToDelete: pathsToDelete}, fieldsToCast, nil
}

//ApplyDelete remove keys from unflatten json according to mapping rules
//Input: unflatten object
//Return copy of object with applied removing keys mappings
func (fm FieldMapper) ApplyDelete(object map[string]interface{}) map[string]interface{} {
	mappedObject := map[string]interface{}{}
	for k, v := range object {
		mappedObject[k] = v
	}

	for _, path := range fm.pathsToDelete {
		parts := strings.Split(path, "/")
		//dive into inner and remove last key from mapping '/key1/../lastkey'
		inner := mappedObject
		for i := 0; i < len(parts); i++ {
			key := parts[i]
			if i == len(parts)-1 {
				delete(inner, key)
				break
			}

			if sub, ok := inner[key]; ok {
				if subMap, ok := sub.(map[string]interface{}); ok {
					inner = subMap
					continue
				}
			}

			break
		}
	}
	return mappedObject
}

//Map rewrite source to destination
//Input: flattened object
//Return same object with applied mappings
func (fm FieldMapper) Map(object map[string]interface{}) (map[string]interface{}, error) {
	for _, rule := range fm.rules {
		v, ok := object[rule.source]
		if ok {
			delete(object, rule.source)
			object[rule.destination] = v
		}
	}
	return object, nil
}

//Return object as is
func (DummyMapper) Map(object map[string]interface{}) (map[string]interface{}, error) {
	return object, nil
}

//Return object as is
func (DummyMapper) ApplyDelete(object map[string]interface{}) map[string]interface{} {
	return object
}

//Replace all '/' with '_'
func formatKey(key string) string {
	return strings.ReplaceAll(formatPrefixSuffix(key), "/", "_")
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
