package schema

import (
	"fmt"
	"log"
	"strings"
)

type Mapper interface {
	Map(object map[string]interface{}) map[string]interface{}
}

type FieldMapper struct {
	rules []*MappingRule
}

type DummyMapper struct{}

type MappingRule struct {
	source      string
	destination string
}

func NewFieldMapper(mappings []string) (Mapper, error) {
	if len(mappings) == 0 {
		return &DummyMapper{}, nil
	}

	var rules []*MappingRule
	for _, mapping := range mappings {
		mappingWithoutSpaces := strings.ReplaceAll(mapping, " ", "")
		parts := strings.Split(mappingWithoutSpaces, "->")

		if len(parts) != 2 {
			return nil, fmt.Errorf("Malformed data mapping [%s]. Use format: /field1/subfield1 -> /field2/subfield2", mapping)
		}

		rules = append(rules, &MappingRule{
			source:      formatKey(parts[0]),
			destination: formatKey(parts[1]),
		})
	}

	log.Println("Configured field mapping rules:")
	for _, r := range rules {
		log.Println(r.source, "->", r.destination)
	}

	return &FieldMapper{rules: rules}, nil
}

//Rewrite source to destination and other keys as is
//Return copy of object with applied mappings
func (fm FieldMapper) Map(object map[string]interface{}) map[string]interface{} {
	mappedObject := map[string]interface{}{}
	for k, v := range object {
		mappedObject[k] = v
	}

	for _, rule := range fm.rules {
		v, ok := mappedObject[rule.source]
		if ok {
			delete(mappedObject, rule.source)
			if rule.destination != "" {
				mappedObject[rule.destination] = v
			}
		}
	}
	return mappedObject
}

//Return object as is
func (DummyMapper) Map(object map[string]interface{}) map[string]interface{} {
	return object
}

//Replace all '/' with '_'
func formatKey(key string) string {
	if strings.HasPrefix(key, "/") {
		key = key[1:]
	}
	return strings.ReplaceAll(key, "/", "_")
}
