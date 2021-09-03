package base

import (
	"fmt"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/schema"
	"github.com/jitsucom/jitsu/server/typing"
	"io"
)

type CLIParser interface {
	Parse(stdout io.ReadCloser) error
}

//Property is a dto for catalog properties representation
type Property struct {
	//might be string or []string or nil
	Type       interface{}          `json:"type,omitempty"`
	Format     string               `json:"format,omitempty"`
	Properties map[string]*Property `json:"properties,omitempty"`
}

//ParseProperties recursively parses singer/airbyte catalog properties and enriches resultFields
func ParseProperties(system, prefix string, properties map[string]*Property, resultFields schema.Fields) {
	for originName, property := range properties {
		name := schema.Reformat(originName)
		var types []string

		switch property.Type.(type) {
		case string:
			types = append(types, property.Type.(string))
		case []interface{}:
			propertyTypesAr := property.Type.([]interface{})
			for _, typeValue := range propertyTypesAr {
				types = append(types, fmt.Sprint(typeValue))
			}
		default:
			logging.Warnf("Unknown %s property [%s] type: %T", system, originName, property.Type)
		}

		for _, t := range types {
			var fieldType typing.DataType
			switch t {
			case "null":
				continue
			case "string":
				if property.Format == "date-time" {
					fieldType = typing.TIMESTAMP
				} else {
					fieldType = typing.STRING
				}
			case "number":
				fieldType = typing.FLOAT64
			case "integer":
				fieldType = typing.INT64
			case "boolean":
				fieldType = typing.BOOL
			case "array":
				fieldType = typing.STRING
			case "object":
				ParseProperties(system, prefix+name+"_", property.Properties, resultFields)
				continue
			default:
				logging.Errorf("Unknown type in %s schema: %s", system, t)
				continue
			}

			//merge all singer types
			key := prefix + name
			field, ok := resultFields[key]
			if ok {
				newFieldType := schema.NewField(fieldType)
				field.Merge(&newFieldType)
				resultFields[key] = field
			} else {
				resultFields[key] = schema.NewField(fieldType)
			}
		}
	}
}
