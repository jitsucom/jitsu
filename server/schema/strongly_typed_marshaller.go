package schema

import (
	"bytes"
	"fmt"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/typing"
	"github.com/xitongsys/parquet-go-source/writerfile"
	"github.com/xitongsys/parquet-go/types"
	"github.com/xitongsys/parquet-go/writer"
	"time"
)

type StronglyTypedMarshaller interface {
	Marshal(bh *BatchHeader, data []map[string]interface{}) ([]byte, error)
}

func NewParquetMarshaller() StronglyTypedMarshaller {
	pm := &ParquetMarshaller{
		GoroutinesCount: 2,
	}
	return pm
}

type ParquetMarshaller struct {
	GoroutinesCount int64
}

func (pm *ParquetMarshaller) Marshal(bh *BatchHeader, data []map[string]interface{}) ([]byte, error) {
	md, fieldIndex := pm.parquetMetadata(bh)
	buf := new(bytes.Buffer)
	fw := writerfile.NewWriterFile(buf)
	defer fw.Close()
	pw, err := writer.NewCSVWriter(md, fw, pm.GoroutinesCount)
	if err != nil {
		return nil, fmt.Errorf("can't create parquet writer: %v", err)
	}
	defer func() {
		if err = pw.WriteStop(); err != nil {
			logging.Errorf("parquet writeStop error: %v", err)
		}
	}()
	for _, obj := range data {
		parquetRec := pm.parquetRecord(bh, obj, fieldIndex)
		if err = pw.Write(parquetRec); err != nil {
			logging.Warnf("parquet write error", err)
		}
	}
	return buf.Bytes(), nil
}

func (pm *ParquetMarshaller) parquetMetadata(bh *BatchHeader) ([]string, map[string]int) {
	md := make([]string, 0, len(bh.Fields))
	fieldIndex := make(map[string]int, len(bh.Fields))
	i := 0
	for field, fieldMeta := range bh.Fields {
		fieldIndex[field] = i
		switch *fieldMeta.dataType {
		case typing.BOOL:
			md = append(md, fmt.Sprintf("name=%s, type=BOOLEAN", field))
		case typing.INT64:
			md = append(md, fmt.Sprintf("name=%s, type=INT64", field))
		case typing.FLOAT64:
			md = append(md, fmt.Sprintf("name=%s, type=DOUBLE", field))
		case typing.STRING:
			md = append(md, fmt.Sprintf("name=%s, type=BYTE_ARRAY, convertedtype=UTF8, encoding=PLAIN_DICTIONARY", field))
		case typing.TIMESTAMP:
			md = append(md, fmt.Sprintf("name=%s, type=TIMESTAMP_MILLIS", field))
		// UNKNOWN and default
		default:
			md = append(md, fmt.Sprintf("name=%s, type=BYTE_ARRAY, convertedtype=UTF8, encoding=PLAIN_DICTIONARY", field))
		}
		i++
	}
	return md, fieldIndex
}

func (pm *ParquetMarshaller) parquetRecord(bh *BatchHeader, obj map[string]interface{}, fieldIndex map[string]int) []interface{} {
	rec := make([]interface{}, len(fieldIndex))
	for field, index := range fieldIndex {
		fieldMeta, ok1 := bh.Fields[field]
		fieldValue, ok2 := obj[field]
		if !ok1 || !ok2 {
			continue
		}
		switch *fieldMeta.dataType {
		case typing.BOOL, typing.INT64, typing.FLOAT64, typing.STRING:
			rec[index] = fieldValue
		case typing.TIMESTAMP:
			switch fieldValue := fieldValue.(type) {
			case time.Time:
				rec[index] = types.TimeToTIMESTAMP_MILLIS(fieldValue, true)
			default:
				rec[index] = types.TimeToTIMESTAMP_MILLIS(time.Now(), true)
			}
		// UNKNOWN and default
		default:
			rec[index] = "UNKNOWN"
		}
	}
	return rec
}
