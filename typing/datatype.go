package typing

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/jitsucom/eventnative/logging"
)

type DataType int

const (
	//IMPORTANT: order of iota values. Int values according to Typecast tree (see typing.typecastTree)
	UNKNOWN DataType = iota
	BOOL
	INT64
	FLOAT64
	STRING
	TIMESTAMP
)

var (
	inputStringToType = map[string]DataType{
		"string":    STRING,
		"integer":   INT64,
		"double":    FLOAT64,
		"timestamp": TIMESTAMP,
		"boolean":   BOOL,
	}
	typeToInputString = map[DataType]string{
		STRING:    "string",
		INT64:     "integer",
		FLOAT64:   "double",
		TIMESTAMP: "timestamp",
		BOOL:      "boolean",
	}
)

func (dt DataType) String() string {
	switch dt {
	default:
		return ""
	case STRING:
		return "STRING"
	case INT64:
		return "INT64"
	case FLOAT64:
		return "FLOAT64"
	case TIMESTAMP:
		return "TIMESTAMP"
	case BOOL:
		return "BOOL"
	case UNKNOWN:
		return "UNKNOWN"
	}
}

func TypeFromString(t string) (DataType, error) {
	trimmed := strings.TrimSpace(t)
	lowerTrimmed := strings.ToLower(trimmed)
	dataType, ok := inputStringToType[lowerTrimmed]
	if !ok {
		return UNKNOWN, fmt.Errorf("Unknown casting type: %s", t)
	}
	return dataType, nil
}

func StringFromType(dataType DataType) (string, error) {
	str, ok := typeToInputString[dataType]
	if !ok {
		return "", fmt.Errorf("Unable to get string from DataType for: %s", dataType.String())
	}
	return str, nil
}

//ReformatValue process json.Number types into int64 or float64
//note: json.Unmarshal returns json.Number type that can be int or float
//      we have to check does json number have dot in string representation
// if have -> return float64 otherwise int64
func ReformatValue(v interface{}) interface{} {
	jsonNumber, ok := v.(json.Number)
	if !ok {
		return v
	}

	if strings.Contains(jsonNumber.String(), ".") {
		floatValue, err := jsonNumber.Float64()
		if err != nil {
			logging.Errorf("Error parsing %s into float64: %v", jsonNumber.String(), err)
			return v
		}
		return interface{}(floatValue)
	}

	intValue, err := jsonNumber.Int64()
	if err != nil {
		logging.Errorf("Error parsing %s into int64: %v", jsonNumber.String(), err)
		return v
	}
	return interface{}(intValue)
}

// ReformatTimeValue processes string with ISO DateTime into time.Time
func ReformatTimeValue(value interface{}) interface{} {
	stringValue, ok := value.(string)
	if !ok {
		return value
	}

	timeValue, err := time.Parse(time.RFC3339Nano, stringValue)
	if err == nil {
		return timeValue
	}

	return value
}

//TypeFromValue return DataType from v type
func TypeFromValue(v interface{}) (DataType, error) {
	switch v.(type) {
	case string:
		return STRING, nil
	case float32, float64:
		return FLOAT64, nil
	case int, int8, int16, int32, int64:
		return INT64, nil
	case time.Time:
		return TIMESTAMP, nil
	case bool:
		return BOOL, nil
	default:
		return UNKNOWN, fmt.Errorf("Unknown DataType for value: %v type: %t", v, v)
	}
}
