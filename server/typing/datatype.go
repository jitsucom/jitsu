package typing

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/jitsucom/jitsu/server/timestamp"

	"github.com/jitsucom/jitsu/server/logging"
)

// DataType is a type representation of common data types
type DataType int

const (
	//IMPORTANT: order of iota values. Int values according to Typecast tree (see typing.typecastTree)

	//UNKNOWN type for error cases
	UNKNOWN DataType = iota
	//BOOL type for boolean values
	BOOL
	//INT64 type for int values
	INT64
	//FLOAT64 type for float values
	FLOAT64
	//STRING type for string values
	STRING
	//TIMESTAMP type for string values that match timestamp pattern
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

// TypeFromString returns DataType from input string
// or error if mapping doesn't exist
func TypeFromString(t string) (DataType, error) {
	trimmed := strings.TrimSpace(t)
	lowerTrimmed := strings.ToLower(trimmed)
	dataType, ok := inputStringToType[lowerTrimmed]
	if !ok {
		return UNKNOWN, fmt.Errorf("Unknown casting type: %s", t)
	}
	return dataType, nil
}

// StringFromType returns string representation of DataType
// or error if mapping doesn't exist
func StringFromType(dataType DataType) (string, error) {
	str, ok := typeToInputString[dataType]
	if !ok {
		return "", fmt.Errorf("Unable to get string from DataType for: %s", dataType.String())
	}
	return str, nil
}

// ReformatNumberValue process json.Number types into int64 or float64
// processes string with ISO DateTime or Golang layout into time.Time
// note: json.Unmarshal returns json.Number type that can be int or float
//
//	we have to check does json number have dot in string representation
//
// if have -> return float64 otherwise int64
func ReformatValue(v interface{}) interface{} {
	v = ReformatNumberValue(v)
	return ReformatTimeValue(v)
}

// ReformatNumberValue process json.Number types into int64 or float64
// note: json.Unmarshal returns json.Number type that can be int or float
//
//	we have to check does json number have dot in string representation
//
// if have -> return float64 otherwise int64
func ReformatNumberValue(v interface{}) interface{} {
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

// ReformatTimeValue processes string with ISO DateTime or Golang layout into time.Time
func ReformatTimeValue(value interface{}) interface{} {
	stringValue, ok := value.(string)
	if !ok {
		return value
	}

	timeValue, err := time.Parse(time.RFC3339Nano, stringValue)
	if err == nil {
		return timeValue
	}

	timeValue, err = time.Parse(timestamp.GolangLayout, stringValue)
	if err == nil {
		return timeValue
	}

	timeValue, err = time.Parse(timestamp.DBLayout, stringValue)
	if err == nil {
		return timeValue
	}

	return value
}

// TypeFromValue return DataType from v type
func TypeFromValue(v interface{}) (DataType, error) {
	switch v.(type) {
	case string:
		return STRING, nil
	case float32, float64:
		return FLOAT64, nil
	case int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64:
		return INT64, nil
	case time.Time:
		return TIMESTAMP, nil
	case bool:
		return BOOL, nil
	default:
		return UNKNOWN, fmt.Errorf("Unknown DataType for value: %v type: %t", v, v)
	}
}

func DataTypePtr(dt DataType) *DataType {
	return &dt
}

func ParseTimestamp(rawTimestamp interface{}) (time.Time, error) {
	switch t := rawTimestamp.(type) {
	case time.Time:
		return t, nil
	case *time.Time:
		return *t, nil
	case string:
		parsed, err := time.Parse(time.RFC3339Nano, t)
		if err != nil {
			return time.Time{}, fmt.Errorf("error parsing string value using time.RFC3339Nano template: %v", err)
		}
		return parsed, nil
	default:
		return time.Time{}, fmt.Errorf("timestamp value has unparsable type")
	}
}
