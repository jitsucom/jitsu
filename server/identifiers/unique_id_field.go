package identifiers

import (
	"fmt"
	"github.com/jitsucom/jitsu/server/jsonutils"
)

//UniqueID is a struct for extracting unique ID from objects
type UniqueID struct {
	jsonPath jsonutils.JSONPath
}

//NewUniqueID returns new UniqueID instance
func NewUniqueID(uniqueIDField string) *UniqueID {
	return &UniqueID{jsonPath: jsonutils.NewJSONPath(uniqueIDField)}
}

//Extract returns extracted global unique ID from input object
func (uid *UniqueID) Extract(obj map[string]interface{}) string {
	if obj == nil {
		return ""
	}

	value, ok := uid.jsonPath.Get(obj)
	if ok {
		return fmt.Sprint(value)
	}

	value, ok = obj[uid.GetFlatFieldName()]
	if ok {
		return fmt.Sprint(value)
	}

	return ""
}

//ExtractAndRemove returns extracted global unique ID from input object and remove it from the objects
func (uid *UniqueID) ExtractAndRemove(obj map[string]interface{}) string {
	if obj == nil {
		return ""
	}

	value, ok := uid.jsonPath.GetAndRemove(obj)
	if ok {
		return fmt.Sprint(value)
	}

	value, ok = obj[uid.GetFlatFieldName()]
	if ok {
		delete(obj, uid.GetFlatFieldName())
		return fmt.Sprint(value)
	}

	return ""
}

//Set puts ID into the object
func (uid *UniqueID) Set(obj map[string]interface{}, id string) error {
	return uid.jsonPath.Set(obj, id)
}

//GetFlatFieldName returns field name (/key1/key2 -> key1_key2)
func (uid *UniqueID) GetFlatFieldName() string {
	return uid.jsonPath.FieldName()
}

//GetFieldName returns field name as is
func (uid *UniqueID) GetFieldName() string {
	return uid.jsonPath.String()
}
