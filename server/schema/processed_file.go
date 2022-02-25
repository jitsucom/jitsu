package schema

import (
	"bytes"
	"github.com/jitsucom/jitsu/server/logging"
	"strings"
)

//ProcessedFile collect data in payload and return it in two formats
type ProcessedFile struct {
	FileName    string
	BatchHeader *BatchHeader

	payload           []map[string]interface{}
	RecognitionPayload bool
	originalRawEvents []string
	eventsSrc         map[string]int
}

//GetOriginalRawEvents return payload as is
func (pf *ProcessedFile) GetOriginalRawEvents() []string {
	return pf.originalRawEvents
}

//GetPayload return payload as is
func (pf *ProcessedFile) GetPayload() []map[string]interface{} {
	return pf.payload
}

//GetPayloadLen return count of rows(objects)
func (pf *ProcessedFile) GetPayloadLen() int {
	return len(pf.payload)
}

//GetPayloadBytes returns marshaling by marshaller func, joined with \n,  bytes
//assume that payload can't be empty
func (pf *ProcessedFile) GetPayloadBytes(marshaller Marshaller) []byte {
	b, _ := pf.GetPayloadBytesWithHeader(marshaller)
	return b
}

//GetPayloadUsingStronglyTypedMarshaller returns bytes, containing marshalled payload
//StronglyTypedMarshaller needs to know payload schema (types of fields) to convert payload to byte slice
func (pf *ProcessedFile) GetPayloadUsingStronglyTypedMarshaller(stm StronglyTypedMarshaller) ([]byte, error) {
	return stm.Marshal(pf.BatchHeader, pf.payload)
}

//GetPayloadBytesWithHeader returns marshaling by marshaller func, joined with \n,  bytes
//assume that payload can't be empty
func (pf *ProcessedFile) GetPayloadBytesWithHeader(marshaller Marshaller) ([]byte, []string) {
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

//GetEventsPerSrc returns events quantity per src
func (pf *ProcessedFile) GetEventsPerSrc() map[string]int {
	result := map[string]int{}
	for k, v := range pf.eventsSrc {
		result[k] = v
	}

	return result
}
