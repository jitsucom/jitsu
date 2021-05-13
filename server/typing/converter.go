package typing

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jitsucom/jitsu/server/timestamp"
)

// Typecast tree
//      STRING(4)
//     /      \
//FLOAT64(3)  TIMESTAMP(5)
//    |
//  INT64(2)
//    |
//  BOOL(1)
//
var (
	typecastTree = &typeNode{
		t: STRING,
		left: &typeNode{
			t: FLOAT64,
			left: &typeNode{
				t:    INT64,
				left: &typeNode{t: BOOL},
			},
		},
		right: &typeNode{t: TIMESTAMP},
	}

	DefaultTypes = map[string]DataType{
		timestamp.Key:               TIMESTAMP,
		"eventn_ctx_utc_time":       TIMESTAMP,
		"eventn_ctx_interval_start": TIMESTAMP,
		"eventn_ctx_interval_end":   TIMESTAMP,
		"utc_time":                  TIMESTAMP,
		"interval_start":            TIMESTAMP,
		"interval_end":              TIMESTAMP,
	}
	convertRules = map[rule]ConvertFunc{
		rule{from: BOOL, to: STRING}:      boolToString,
		rule{from: INT64, to: STRING}:     numberToString,
		rule{from: FLOAT64, to: STRING}:   numberToString,
		rule{from: TIMESTAMP, to: STRING}: timestampToString,

		rule{from: BOOL, to: INT64}: boolToNumber,

		rule{from: BOOL, to: FLOAT64}:  boolToFloat,
		rule{from: INT64, to: FLOAT64}: numberToFloat,

		rule{from: STRING, to: TIMESTAMP}: stringToTimestamp,

		// Future
		/*rule{from: STRING, to: INT64}:     stringToInt,
		  rule{from: STRING, to: FLOAT64}:   stringToFloat,
		  rule{from: FLOAT64, to: INT64}: floatToInt,*/
	}

	charsInNumberStringReplacer = strings.NewReplacer(",", "", " ", "")
)

type typeNode struct {
	t     DataType
	left  *typeNode
	right *typeNode
}

//ConvertFunc is a function for a certain DataType conversion
type ConvertFunc func(v interface{}) (interface{}, error)

type rule struct {
	from DataType
	to   DataType
}

//IsConvertible returns false if there isn't any rule for converting from DataType into to DataType
func IsConvertible(from DataType, to DataType) bool {
	if from == to {
		return true
	}

	if _, ok := convertRules[rule{from: from, to: to}]; ok {
		return true
	}

	return false
}

//Convert returns converted into toType value
//or error if occurred
func Convert(toType DataType, v interface{}) (interface{}, error) {
	currentType, err := TypeFromValue(v)
	if err != nil {
		return nil, err
	}

	if currentType == toType {
		return v, nil
	}

	f, ok := convertRules[rule{from: currentType, to: toType}]
	if !ok {
		return nil, fmt.Errorf("No rule for converting %s to %s", currentType.String(), toType.String())
	}

	return f(v)
}

//GetCommonAncestorType returns lowest common ancestor type
func GetCommonAncestorType(t1, t2 DataType) DataType {
	return lowestCommonAncestor(typecastTree, t1, t2)
}

func lowestCommonAncestor(root *typeNode, t1, t2 DataType) DataType {
	// Start from the root node of the tree
	node := root

	// Traverse the tree
	for node != nil {
		if t1 > node.t && t2 > node.t {
			// If both t1 and t2 are greater than parent
			node = node.right
		} else if t1 < node.t && t2 < node.t {
			// If both t1 and t2 are lesser than parent
			node = node.left
		} else {
			// We have found the split point, i.e. the LCA node.
			return node.t
		}
	}

	return UNKNOWN
}

//assume that input v can't be nil
func numberToString(v interface{}) (interface{}, error) {
	switch v.(type) {
	case int64:
		int64Value, _ := v.(int64)
		return strconv.FormatInt(int64Value, 10), nil
	case int32:
		int32Value, _ := v.(int32)
		return strconv.FormatInt(int64(int32Value), 10), nil
	case int:
		intValue, _ := v.(int)
		return strconv.Itoa(intValue), nil
	case int16:
		int16Value, _ := v.(int16)
		return strconv.FormatInt(int64(int16Value), 10), nil
	case int8:
		int8Value, _ := v.(int8)
		return strconv.FormatInt(int64(int8Value), 10), nil
	case float64:
		float64Value, _ := v.(float64)
		return strconv.FormatFloat(float64Value, 'f', -1, 64), nil
	case float32:
		float32Value, _ := v.(float32)
		return strconv.FormatFloat(float64(float32Value), 'f', -1, 64), nil
	case string:
		str, _ := v.(string)
		return str, nil
	default:
		return nil, fmt.Errorf("Error numberToString(): Unknown value type: %t", v)
	}
}

//assume that input v can't be nil
func timestampToString(v interface{}) (interface{}, error) {
	switch v.(type) {
	case time.Time:
		timeValue, _ := v.(time.Time)
		return timeValue.Format(timestamp.Layout), nil
	case string:
		str, _ := v.(string)
		return str, nil
	default:
		return nil, fmt.Errorf("Error timestampToString(): Unknown value type: %t", v)
	}
}

func numberToFloat(v interface{}) (interface{}, error) {
	switch v.(type) {
	case int:
		return float64(v.(int)), nil
	case int8:
		return float64(v.(int8)), nil
	case int16:
		return float64(v.(int16)), nil
	case int32:
		return float64(v.(int32)), nil
	case int64:
		return float64(v.(int64)), nil
	case float32:
		return float64(v.(float32)), nil
	case float64:
		return v.(float64), nil
	default:
		return nil, fmt.Errorf("Value: %v with type: %t isn't int", v, v)
	}
}

func boolToString(v interface{}) (interface{}, error) {
	switch v.(type) {
	case bool:
		boolValue, _ := v.(bool)
		return strconv.FormatBool(boolValue), nil
	default:
		return nil, fmt.Errorf("Error boolToString(): Unknown value type: %t", v)
	}
}

func boolToNumber(v interface{}) (interface{}, error) {
	switch v.(type) {
	case bool:
		boolValue, _ := v.(bool)
		if boolValue {
			return int64(1), nil
		}

		return int64(0), nil
	default:
		return nil, fmt.Errorf("Error boolToNumber(): Unknown value type: %t", v)
	}
}

func boolToFloat(v interface{}) (interface{}, error) {
	switch v.(type) {
	case bool:
		boolValue, _ := v.(bool)
		if boolValue {
			return float64(1), nil
		}

		return float64(0), nil
	default:
		return nil, fmt.Errorf("Error boolToFloat(): Unknown value type: %t", v)
	}
}

//StringToInt returns int representation of input string
//or error if unconvertable
func StringToInt(v interface{}) (interface{}, error) {
	intValue, err := strconv.Atoi(v.(string))
	if err != nil {
		return nil, fmt.Errorf("Error stringToInt() for value: %v: %v", v, err)
	}

	return int64(intValue), nil
}

//StringToFloat return float64 value from string
//or error if unconvertable
func StringToFloat(v interface{}) (interface{}, error) {
	floatValue, err := strconv.ParseFloat(v.(string), 64)
	if err != nil {
		return nil, fmt.Errorf("Error stringToFloat() for value: %v: %v", v, err)
	}

	return floatValue, nil
}

func stringToTimestamp(v interface{}) (interface{}, error) {
	t, err := time.Parse(time.RFC3339Nano, v.(string))
	if err != nil {
		return nil, fmt.Errorf("Error stringToTimestamp() for value: %v: %v", v, err)
	}

	return t, nil
}

//StringWithCommasToFloat return float64 value from string (1,200.50)
func StringWithCommasToFloat(v interface{}) (interface{}, error) {
	return StringToFloat(charsInNumberStringReplacer.Replace(v.(string)))
}

func floatToInt(v interface{}) (interface{}, error) {
	switch v.(type) {
	case float32:
		return int64(v.(float32)), nil
	case float64:
		return int64(v.(float64)), nil
	default:
		return nil, fmt.Errorf("Value: %v with type: %t isn't float", v, v)
	}
}
