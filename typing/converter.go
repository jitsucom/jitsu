package typing

import (
	"fmt"
	"github.com/ksensehq/eventnative/timestamp"
	"strconv"
	"time"
)

// Typecast tree
//      STRING(3)
//     /      \
//FLOAT64(2)  TIMESTAMP(4)
//    |
//  INT64(1)
//
var (
	typecastTree = &typeNode{
		t: STRING,
		left: &typeNode{
			t:    FLOAT64,
			left: &typeNode{t: INT64},
		},
		right: &typeNode{t: TIMESTAMP},
	}
	DefaultTypes = map[string]DataType{
		timestamp.Key:         TIMESTAMP,
		"eventn_ctx_utc_time": TIMESTAMP,
	}
	convertRules = map[rule]ConvertFunc{
		rule{from: INT64, to: STRING}:     numberToString,
		rule{from: FLOAT64, to: STRING}:   numberToString,
		rule{from: TIMESTAMP, to: STRING}: timestampToString,

		rule{from: INT64, to: FLOAT64}: intToFloat,

		rule{from: STRING, to: TIMESTAMP}: stringToTimestamp,

		// Future
		/*rule{from: STRING, to: INT64}:     stringToInt,
		rule{from: STRING, to: FLOAT64}:   stringToFloat,
		rule{from: FLOAT64, to: INT64}: floatToInt,*/
	}
)

type typeNode struct {
	t     DataType
	left  *typeNode
	right *typeNode
}

type ConvertFunc func(v interface{}) (interface{}, error)

type rule struct {
	from DataType
	to   DataType
}

func IsConvertible(from DataType, to DataType) bool {
	if from == to {
		return true
	}

	if _, ok := convertRules[rule{from: from, to: to}]; ok {
		return true
	}

	return false
}

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

func intToFloat(v interface{}) (interface{}, error) {
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
	default:
		return nil, fmt.Errorf("Value: %v with type: %t isn't int", v, v)
	}
}

func stringToInt(v interface{}) (interface{}, error) {
	intValue, err := strconv.Atoi(v.(string))
	if err != nil {
		return nil, fmt.Errorf("Error stringToInt() for value: %v: %v", v, err)
	}

	return int64(intValue), nil
}

func stringToFloat(v interface{}) (interface{}, error) {
	floatValue, err := strconv.ParseFloat(v.(string), 64)
	if err != nil {
		return nil, fmt.Errorf("Error stringToFloat() for value: %v: %v", v, err)
	}

	return floatValue, nil
}

func stringToTimestamp(v interface{}) (interface{}, error) {
	t, err := time.Parse(timestamp.Layout, v.(string))
	if err != nil {
		return nil, fmt.Errorf("Error stringToTimestamp() for value: %v: %v", v, err)
	}

	return t, nil
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
