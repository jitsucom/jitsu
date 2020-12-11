package schema

import (
	"bytes"
	"github.com/jitsucom/eventnative/logging"
	"strings"
)

//ProcessedFile collect data in payload and return it in two formats
type ProcessedFile struct {
	FileName    string
	BatchHeader *BatchHeader

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

//GetPayloadBytes return marshaling by marshaller func, joined with \n,  bytes
//assume that payload can't be empty
func (pf ProcessedFile) GetPayloadBytes(marshaller Marshaller) []byte {
	b, _ := pf.GetPayloadBytesWithHeader(marshaller)
	return b
}

//GetPayloadBytes return marshaling by marshaller func, joined with \n,  bytes
//assume that payload can't be empty
func (pf ProcessedFile) GetPayloadBytesWithHeader(marshaller Marshaller) ([]byte, []string) {
	var buf *bytes.Buffer

	var fields []string
	//for csv writers using || delimiter
	if marshaller.NeedHeader() {
		fields = pf.BatchHeader.Fields.Header()
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

	return buf.Bytes(), fields
}
