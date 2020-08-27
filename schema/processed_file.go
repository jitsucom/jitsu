package schema

import (
	"bytes"
	"encoding/json"
	"log"
)

//ProcessedFile collect data in payload and return it in two formats
type ProcessedFile struct {
	FileName   string
	DataSchema *Table

	payload []map[string]interface{}
}

//GetPayload return payload as is
func (pf ProcessedFile) GetPayload() []map[string]interface{} {
	return pf.payload
}

//GetPayloadBytes return marshaling into json, joined with \n,  bytes
//assume that payload can't be empty
func (pf ProcessedFile) GetPayloadBytes() []byte {
	var buf *bytes.Buffer

	for _, object := range pf.payload {
		objectBytes, err := json.Marshal(object)
		if err != nil {
			log.Println("Error marshaling object in processed file:", err)
		} else {
			if buf == nil {
				buf = bytes.NewBuffer(objectBytes)
			} else {
				buf.Write([]byte("\n"))
				buf.Write(objectBytes)
			}
		}
	}

	return buf.Bytes()
}
