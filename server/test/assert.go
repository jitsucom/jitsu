package test

import (
	"encoding/json"
	"fmt"
	"github.com/stretchr/testify/assert"
	"reflect"
	"testing"
)

//JSONBytesEqual unmarshalls two jsons into objects and uses ObjectsEqual
func JSONBytesEqual(t *testing.T, expected, actual []byte, msgAndArgs ...interface{}) {
	var expectedObj, actualObj map[string]interface{}
	if err := json.Unmarshal(expected, &expectedObj); err != nil {
		assert.Fail(t, "Error unmarshalling expected object: "+string(expected)+" err:"+err.Error(), msgAndArgs...)
	}
	if err := json.Unmarshal(actual, &actualObj); err != nil {
		assert.Fail(t, "Error unmarshalling actual object: "+string(actual)+" err:"+err.Error(), msgAndArgs...)
	}
	ObjectsEqual(t, expectedObj, actualObj, msgAndArgs)
}

//ObjectsEqual uses reflect.DeepEqual under the hood
func ObjectsEqual(t *testing.T, expected, actual interface{}, msgAndArgs ...interface{}) {
	if !reflect.DeepEqual(expected, actual) {
		a, _ := json.Marshal(actual)
		e, _ := json.Marshal(expected)
		assert.Fail(t, fmt.Sprintf("Objects aren't equal \n Expected: %s \n Actual: %s", string(e), string(a)), msgAndArgs...)
	}
}
