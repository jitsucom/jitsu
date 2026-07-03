package types

import (
	"encoding/json"
	"fmt"
	"github.com/jitsucom/bulker/jitsubase/logging"
	"github.com/jitsucom/bulker/jitsubase/timestamp"
	"reflect"
	"strings"
	"time"
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
	//JSON type for json values
	JSON
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

	zeroTime = time.Time{}
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

func (dt DataType) AvroType() any {
	switch dt {
	case INT64:
		return []any{"null", "long"}
	case FLOAT64:
		return []any{"null", "double"}
	case TIMESTAMP:
		return []any{"null", map[string]string{"logicalType": "timestamp-millis", "type": "long"}}
	case BOOL:
		return []any{"null", "boolean"}
	case JSON:
		return []any{"null", map[string]string{"type": "string", "sqlType": "json"}}
	case UNKNOWN:
		return []any{"null", "string"}
	default:
		return []any{"null", "string"}
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
// note: jsoniter.Unmarshal returns json.Number type that can be int or float
//
//	we have to check does json number have dot in string representation
//
// if have -> return float64 otherwise int64
func ReformatValue(v any) (any, bool) {
	n, ok := ReformatNumberValue(v)
	if ok {
		return n, true
	}
	ts, ok := ReformatTimeValue(v, false)
	if ok {
		return ts, true
	} else {
		return v, false
	}
}

// ReformatNumberValue process json.Number types into int64 or float64
// note: jsoniter.Unmarshal returns json.Number type that can be int or float
//
//	we have to check does json number have dot in string representation
//
// if have -> return float64 otherwise int64
func ReformatNumberValue(v any) (any, bool) {
	jsonNumber, ok := v.(json.Number)
	if !ok {
		return v, false
	}

	return ReformatJSONNumberValue(jsonNumber), true
}

func ReformatJSONNumberValue(jsonNumber json.Number) any {
	str := jsonNumber.String()
	if strings.ContainsAny(str, ".eE") {
		floatValue, err := jsonNumber.Float64()
		if err != nil {
			logging.Debugf("Error parsing %s into float64: %v", str, err)
			return str
		}
		return floatValue
	}

	intValue, err := jsonNumber.Int64()
	if err != nil {
		logging.Debugf("Error parsing %s into int64: %v", str, err)
		return str
	}
	return intValue
}

// ReformatTimeValue processes string with ISO DateTime or Golang layout into time.Time
func ReformatTimeValue(value any, supportDates bool) (time.Time, bool) {
	stringValue, ok := value.(string)
	if !ok {
		return zeroTime, false
	}

	l := len(stringValue)

	minLength := 19 // len("2006-01-02T15:04:05")
	if supportDates {
		minLength = 10 //len("2006-01-02")
	}

	if l < minLength || l > 35 {
		//strings shorter than shortest of layouts or longer then longest of layouts are obviously not dates
		return zeroTime, false
	}

	char := stringValue[0]
	if char != '1' && char != '2' {
		return zeroTime, false
	}

	timeValue, err := time.Parse(time.RFC3339Nano, stringValue)
	if err == nil {
		return timeValue.UTC(), true
	}

	if l == len(timestamp.GolangLayout) {
		timeValue, err = time.Parse(timestamp.GolangLayout, stringValue)
		if err == nil {
			return timeValue.UTC(), true
		}
	} else if supportDates && l == len(timestamp.DashDayLayout) {
		timeValue, err = time.Parse(timestamp.DashDayLayout, stringValue)
		if err == nil {
			return timeValue, true
		}
	}

	timeValue, err = time.Parse(timestamp.DBLayout, stringValue)
	if err == nil {
		return timeValue, true
	}

	return zeroTime, false
}

// TypeFromValue return DataType from v type
func TypeFromValue(v any) (DataType, error) {
	switch v.(type) {
	case string:
		return STRING, nil
	case time.Time:
		return TIMESTAMP, nil
	case float32, float64:
		return FLOAT64, nil
	case bool:
		return BOOL, nil
	case int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64:
		return INT64, nil
	case map[string]any, []any, []map[string]any:
		return JSON, nil
	case Object:
		// ordered JSON object (*jsonorder.OrderedMap) - reflect sees a Ptr, not a Map,
		// so it must be matched explicitly
		return JSON, nil
	case nil:
		return UNKNOWN, fmt.Errorf("Unknown DataType for value: %v type: %t", v, v)
	default:
		t := reflect.TypeOf(v).Kind()
		if t == reflect.Map || t == reflect.Slice || t == reflect.Array {
			return JSON, nil
		} else {
			return UNKNOWN, fmt.Errorf("Unknown DataType for value: %v type: %t", v, v)
		}
	}
}

func DataTypePtr(dt DataType) *DataType {
	return &dt
}

func ParseTimestamp(rawTimestamp any) (time.Time, error) {
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
