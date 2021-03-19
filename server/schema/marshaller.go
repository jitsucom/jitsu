package schema

import (
	"bytes"
	"encoding/json"
)

const quotaByteValue = 34

var JsonMarshallerInstance = JsonMarshaller{}
var CsvMarshallerInstance = CsvMarshaller{}

type Marshaller interface {
	Marshal([]string, map[string]interface{}) ([]byte, error)
	NeedHeader() bool
}

type JsonMarshaller struct {
}

//Marshal object as json
func (jm JsonMarshaller) Marshal(fields []string, object map[string]interface{}) ([]byte, error) {
	return json.Marshal(object)
}

func (jm JsonMarshaller) NeedHeader() bool {
	return false
}

type CsvMarshaller struct {
}

//Marshal object as csv values string with || delimiter
func (cm CsvMarshaller) Marshal(fields []string, object map[string]interface{}) ([]byte, error) {
	buf := bytes.Buffer{}

	i := 0
	for _, field := range fields {
		v, ok := object[field]
		if ok {
			//helper function for value serialization
			b, _ := json.Marshal(v)
			//don't write begin and end quotas
			lastIndex := len(b) - 1
			if len(b) >= 2 && b[0] == quotaByteValue && b[lastIndex] == quotaByteValue {
				buf.Write(b[1:lastIndex])
			} else {
				buf.Write(b)
			}
		}
		//don't write delimiter after last element
		if i < len(fields)-1 {
			buf.Write([]byte("||"))
		}
		i++
	}
	return buf.Bytes(), nil
}

func (cm CsvMarshaller) NeedHeader() bool {
	return true
}
