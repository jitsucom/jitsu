package singer

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/schema"
	"github.com/jitsucom/jitsu/server/typing"
	"io"
	"strings"
)

const batchSize = 500

type SchemaRecord struct {
	Type          string   `json:"type,omitempty"`
	Stream        string   `json:"stream,omitempty"`
	Schema        *Schema  `json:"schema,omitempty"`
	KeyProperties []string `json:"key_properties,omitempty"`
}

type Schema struct {
	Properties map[string]*Property `json:"properties,omitempty"`
}

type Property struct {
	//might be string or []string or nil
	Type       interface{}          `json:"type,omitempty"`
	Format     string               `json:"format,omitempty"`
	Properties map[string]*Property `json:"properties,omitempty"`
}

type OutputRepresentation struct {
	State     interface{}
	NeedClean bool
	//[streamName] - {}
	Streams map[string]*StreamRepresentation
}

type StreamRepresentation struct {
	BatchHeader *schema.BatchHeader
	KeyFields   []string
	Objects     []map[string]interface{}
}

func StreamParseOutput(stdout io.ReadCloser, consumer PortionConsumer, logger logging.TaskLogger) error {
	logger.INFO("Singer sync will store data as batches >= [%d] elements size", batchSize)

	outputPortion := &OutputRepresentation{
		Streams: map[string]*StreamRepresentation{},
	}

	scanner := bufio.NewScanner(stdout)
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, 1024*1024)

	records := 0
	initialized := false
	for scanner.Scan() {
		lineBytes := scanner.Bytes()

		lineObject := map[string]interface{}{}
		err := json.Unmarshal(lineBytes, &lineObject)
		if err != nil {
			return fmt.Errorf("Error unmarshalling singer output line %s into json: %v", string(lineBytes), err)
		}

		objectType, ok := lineObject["type"]
		if !ok || objectType == "" {
			return fmt.Errorf("Error getting singer object 'type' field from: %s", string(lineBytes))
		}

		switch objectType {
		case "SCHEMA":
			streamRepresentation, err := parseSchema(lineBytes)
			if err != nil {
				return fmt.Errorf("Error parsing singer schema %s: %v", string(lineBytes), err)
			}

			outputPortion.Streams[streamRepresentation.BatchHeader.TableName] = streamRepresentation
		case "STATE":
			state, ok := lineObject["value"]
			if !ok {
				return fmt.Errorf("Error parsing singer state line %s: malformed state line 'value' doesn't exist", string(lineBytes))
			}

			outputPortion.State = state
			outputPortion.NeedClean = !initialized && strings.Contains(string(lineBytes), "FULL_TABLE")
			//persist batch and recreate variables
			if records >= batchSize {
				err := consumer.Consume(outputPortion)
				if err != nil {
					return err
				}

				//remove already persisted objects
				for _, stream := range outputPortion.Streams {
					stream.Objects = []map[string]interface{}{}
				}
				records = 0
				initialized = true
			}
		case "RECORD":
			records++
			streamName, object, err := parseRecord(lineObject)
			if err != nil {
				return fmt.Errorf("Error parsing singer record line %s: %v", string(lineBytes), err)
			}

			streamName = schema.Reformat(streamName)

			outputPortion.Streams[streamName].Objects = append(outputPortion.Streams[streamName].Objects, object)
		default:
			msg := fmt.Sprintf("Unknown Singer output line type: %s [%v]", objectType, lineObject)
			logging.Warnf(msg)
			logger.WARN(msg)
		}
	}

	//persist last batch
	if records > 0 {
		err := consumer.Consume(outputPortion)
		if err != nil {
			return err
		}
	}

	err := scanner.Err()
	if err != nil {
		return err
	}

	return nil
}

func parseRecord(line map[string]interface{}) (string, map[string]interface{}, error) {
	streamName, ok := line["stream"]
	if !ok {
		return "", nil, errors.New("malformed record line 'stream' doesn't exist")
	}

	record, ok := line["record"]
	if !ok {
		return "", nil, errors.New("malformed record line 'record' doesn't exist")
	}

	object, ok := record.(map[string]interface{})
	if !ok {
		return "", nil, errors.New("malformed record line 'record' must be a json object")
	}

	return fmt.Sprint(streamName), object, nil
}

func parseSchema(schemaBytes []byte) (*StreamRepresentation, error) {
	sr := &SchemaRecord{}
	err := json.Unmarshal(schemaBytes, sr)
	if err != nil {
		return nil, fmt.Errorf("Error unmarshalling schema object: %v", err)
	}

	fields := schema.Fields{}
	parseProperties("", sr.Schema.Properties, fields)

	streamName := schema.Reformat(sr.Stream)
	return &StreamRepresentation{
		BatchHeader: &schema.BatchHeader{TableName: streamName, Fields: fields},
		KeyFields:   sr.KeyProperties,
	}, nil
}

func parseProperties(prefix string, properties map[string]*Property, resultFields schema.Fields) {
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
			logging.Warnf("Unknown singer property [%s] type: %T", originName, property.Type)
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
				parseProperties(prefix+name+"_", property.Properties, resultFields)
			default:
				logging.Errorf("Unknown type in singer schema: %s", t)
				continue
			}

			resultFields[prefix+name] = schema.NewField(fieldType)
			break
		}
	}
}
