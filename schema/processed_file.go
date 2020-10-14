package schema

import (
	"bytes"
	"github.com/ksensehq/eventnative/logging"
	"strings"
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

//GetPayloadLen return count of rows(objects)
func (pf ProcessedFile) GetPayloadLen() int {
	return len(pf.payload)
}

//GetPayloadBytes return marshaling by marshaller func, joined with \n,  bytes and rows count
//assume that payload can't be empty
func (pf ProcessedFile) GetPayloadBytes(marshaller Marshaller) ([]byte, int) {
	var buf *bytes.Buffer

	var fields []string
	//for csv writers using || delimiter
	if marshaller.NeedHeader() {
		fields = pf.DataSchema.Columns.Header()
		buf = bytes.NewBuffer([]byte(strings.Join(fields, "||")))
	}

	for _, object := range pf.payload {
		objectBytes, err := marshaller.Marshal(fields, object)
		if err != nil {
			logging.Error("Error marshaling object in processed file:", err)
		} else {
			if buf == nil {
				buf = bytes.NewBuffer(objectBytes)
			} else {
				buf.Write([]byte("\n"))
				buf.Write(objectBytes)
			}
		}
	}

	return buf.Bytes(), len(pf.payload)
}
