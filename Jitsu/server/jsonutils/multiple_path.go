package jsonutils

import (
	"fmt"
	"strings"
)

//MultipleJSONPath is a struct for extracting and setting value by JSON paths with extended syntax
// /key1/key2||/key3/key4
type MultipleJSONPath struct {
	paths []*SingleJSONPath
}

//NewMultipleJSONPath returns MultipleJSONPath instance
func NewMultipleJSONPath(paths []string) *MultipleJSONPath {
	var multiple []*SingleJSONPath
	for _, path := range paths {
		multiple = append(multiple, NewSingleJSONPath(path))
	}

	return &MultipleJSONPath{
		paths: multiple,
	}
}

//IsEmpty returns true if all paths are empty
func (mjp *MultipleJSONPath) IsEmpty() bool {
	for _, jp := range mjp.paths {
		if len(jp.parts) != 0 {
			return false
		}
	}

	return true
}

//Get returns first json path non empty result
func (mjp *MultipleJSONPath) Get(obj map[string]interface{}) (interface{}, bool) {
	for _, jp := range mjp.paths {
		value, ok := jp.getAndRemove(obj, false)
		if ok {
			return value, ok
		}
	}

	return nil, false
}

//GetAndRemove returns first json path non empty result and remove it from origin json
func (mjp *MultipleJSONPath) GetAndRemove(obj map[string]interface{}) (interface{}, bool) {
	for _, jp := range mjp.paths {
		value, ok := jp.getAndRemove(obj, true)
		if ok {
			return value, ok
		}
	}

	return nil, false
}

//SetIfNotExist puts value into the object only if JSON path doesn't exist
//in other words the func DOESN'T overwrite the key with input value
//{key1:"abc", key2:"qwe"} /key1/key2 -> not set
//{key1:"abc", key2:"qwe"} /key1/key3 -> set
func (mjp *MultipleJSONPath) SetIfNotExist(obj map[string]interface{}, value interface{}) error {
	if obj == nil {
		return nil
	}

	_, ok := mjp.Get(obj)
	if ok {
		return nil
	}

	return mjp.Set(obj, value)
}

// SetOrMergeIfExist puts value into the object if JSON path doesn't exist
// if JSON path exist and is a map than all values will be merged separately
// {key1:"abc", key2:"qwe"}        /key1/key3 -> set
// {key1:"abc", key2:{key3:"qwe"}} /key1/key2 -> merge
func (mjp *MultipleJSONPath) SetOrMergeIfExist(obj map[string]interface{}, values map[string]interface{}) error {
	if obj == nil {
		return nil
	}

	existedValue, ok := mjp.Get(obj)
	if !ok {
		return mjp.Set(obj, values)
	}

	if existedMap, ok := existedValue.(map[string]interface{}); ok {
		for key, value := range values {
			if _, exist := existedMap[key]; !exist {
				existedMap[key] = value
			}
		}
	}

	return nil
}

//Set puts value to first json path that exists:
//  {key1:"abc", key2:"qwe"} /key1/key3 -> not set
//  {key1:{key2: {key3: "qwe"}}} /key1/key3 -> not set
//  {key1:{key2: {key3: "qwe"}}} /key1/key2 -> set ok
//  {key1:{}} /key1/key2 -> set ok
//  {} /key1 -> set ok
//returns err if value wasn't set
func (mjp *MultipleJSONPath) Set(obj map[string]interface{}, value interface{}) error {
	if obj == nil {
		return nil
	}

	for _, jp := range mjp.paths {
		if err := jp.setWithInnerCreation(obj, value, false); err != nil {
			if err == ErrNodeNotExist {
				continue
			}

			return err
		}

		return nil
	}

	var paths []string
	for _, jp := range mjp.paths {
		paths = append(paths, jp.String())
	}

	return fmt.Errorf("Unnable to set value with multiple JSON paths [%s] into object: %v", strings.Join(paths, multiplePathsDelimiter), obj)
}

//String returns string representation of JSON path (/key1/key2)
func (mjp *MultipleJSONPath) String() string {
	if len(mjp.paths) == 0 {
		return ""
	}

	return "/" + strings.Join(mjp.paths[0].parts, "/")
}

//FieldName returns string representation of first JSON path
func (mjp *MultipleJSONPath) FieldName() string {
	if len(mjp.paths) == 0 {
		return ""
	}

	return strings.Join(mjp.paths[0].parts, "_")
}
