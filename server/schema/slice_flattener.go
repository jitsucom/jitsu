package schema

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
)

func SliceToSqlArrayOfStrings(slice []interface{}) (interface{}, error) {
	flattened := make([]string, 0, len(slice))
	for _, it := range slice {
		if it == nil {
			continue
		}
		t := reflect.ValueOf(it)
		if t.Kind() == reflect.Map || t.Kind() == reflect.Slice {
			bytes, err := json.Marshal(it)
			if err != nil {
				return nil, fmt.Errorf("can't marshall %v: %v", it, err)
			}
			flattened = append(flattened, fmt.Sprintf("'%v'", string(bytes)))
		} else {
			flattened = append(flattened, fmt.Sprintf("'%v'", it))
		}
	}
	return fmt.Sprintf("[%s]", strings.Join(flattened, ",")), nil
}

func SliceToJsonString(slice []interface{}) (interface{}, error) {
	b, err := json.Marshal(slice)
	if err != nil {
		return nil, err
	}
	return string(b), nil
}