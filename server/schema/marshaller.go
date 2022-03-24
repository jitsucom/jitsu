package schema

import (
	"bytes"
	"encoding/csv"
	"encoding/json"
)

const quotaByteValue = 34

var (
	JSONMarshallerInstance = JSONMarshaller{}
	CSVMarshallerInstance  = CSVMarshaller{}
)

type Marshaller interface {
	Marshal([]string, map[string]interface{}, *bytes.Buffer) error
	NeedHeader() bool
}

type JSONMarshaller struct {
}

//Marshal object as json
func (jm JSONMarshaller) Marshal(fields []string, object map[string]interface{}, buf *bytes.Buffer) error {
	bytes, err := json.Marshal(object)
	if err != nil {
		return err
	}
	_, err = buf.Write(bytes)
	if err != nil {
		return err
	}
	_, err = buf.Write([]byte("\n"))
	return err
}

func (jm JSONMarshaller) NeedHeader() bool {
	return false
}

type CSVMarshaller struct {
}

//Marshal marshals input object as csv values string with delimiter
func (cm CSVMarshaller) Marshal(fields []string, object map[string]interface{}, buf *bytes.Buffer) error {
	csvWriter := csv.NewWriter(buf)
	valuesArr := make([]string, 0, len(fields))
	for _, field := range fields {
		v, ok := object[field]
		strValue := ""
		if ok {
			str, ok := v.(string)
			if ok {
				strValue = str
			} else {
				//use json marshaller to marshal types like arrays and time in unified way
				b, err := json.Marshal(v)
				if err != nil {
					return err
				}
				//don't write begin and end quotas
				lastIndex := len(b) - 1
				if len(b) >= 2 && b[0] == quotaByteValue && b[lastIndex] == quotaByteValue {
					b = b[1:lastIndex]
				}
				strValue = string(b)
			}
		}
		valuesArr = append(valuesArr, strValue)
	}
	err := csvWriter.Write(valuesArr)
	if err != nil {
		return err
	}
	csvWriter.Flush()
	return nil
}

func (cm CSVMarshaller) NeedHeader() bool {
	return true
}
