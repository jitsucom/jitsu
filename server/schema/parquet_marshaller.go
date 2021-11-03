package schema

import (
	"bytes"
	"fmt"
	"github.com/jitsucom/jitsu/server/typing"
	"github.com/xitongsys/parquet-go-source/writerfile"
	"github.com/xitongsys/parquet-go/parquet"
	"github.com/xitongsys/parquet-go/types"
	"github.com/xitongsys/parquet-go/writer"
)

func NewParquetMarshaller(useGZIP bool) StronglyTypedMarshaller {
	pm := &ParquetMarshaller{
		GoroutinesCount: 1,
		UseGZIP:         useGZIP,
	}
	return pm
}

type ParquetMarshaller struct {
	GoroutinesCount int64
	UseGZIP         bool
}

func (pm *ParquetMarshaller) Marshal(bh *BatchHeader, data []map[string]interface{}) ([]byte, error) {
	md, fieldIndex, err := pm.parquetMetadata(bh)
	if err != nil {
		return nil, fmt.Errorf("can't generate parquet type metadata: %v", err)
	}
	buf := new(bytes.Buffer)
	fw := writerfile.NewWriterFile(buf)
	defer fw.Close()
	pw, err := writer.NewCSVWriter(md, fw, pm.GoroutinesCount)
	if pm.UseGZIP {
		pw.CompressionType = parquet.CompressionCodec_GZIP
	}
	if err != nil {
		return nil, fmt.Errorf("can't create parquet writer: %v", err)
	}
	for _, obj := range data {
		parquetRec, err := pm.parquetRecord(bh, obj, fieldIndex)
		if err != nil {
			return nil, fmt.Errorf("can't prepare parquet record: %v", err)
		}
		if err = pw.Write(parquetRec); err != nil {
			return nil, fmt.Errorf("parquet write error: %v", err)
		}
	}
	if err = pw.WriteStop(); err != nil {
		return nil, fmt.Errorf("can't flush parquet buffer: %v", err)
	}
	return buf.Bytes(), nil
}

func (pm *ParquetMarshaller) parquetMetadata(bh *BatchHeader) ([]string, map[string]int, error) {
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
			md = append(md, fmt.Sprintf("name=%s, type=INT64, logicaltype=TIMESTAMP, logicaltype.isadjustedtoutc=true, logicaltype.unit=MILLIS", field))
		// UNKNOWN and default
		default:
			return nil, nil, fmt.Errorf("field %s has unmappable type", field)
		}
		i++
	}
	return md, fieldIndex, nil
}

func (pm *ParquetMarshaller) parquetRecord(bh *BatchHeader, obj map[string]interface{}, fieldIndex map[string]int) ([]interface{}, error) {
	rec := make([]interface{}, len(fieldIndex))
	for field, index := range fieldIndex {
		fieldMeta, ok1 := bh.Fields[field]
		fieldValue, ok2 := obj[field]
		if !ok1 || !ok2 {
			continue
		}
		fdt := *fieldMeta.dataType
		switch fdt {
		case typing.BOOL, typing.INT64, typing.FLOAT64, typing.STRING:
			rec[index] = fieldValue
		case typing.TIMESTAMP:
			t, err := typing.ParseTimestamp(fieldValue)
			if err != nil {
				return nil, err
			}
			rec[index] = types.TimeToTIMESTAMP_MILLIS(t, true)
		// UNKNOWN and default
		default:
			return nil, fmt.Errorf("field %s has unsupported data type %v", field, fdt)
		}
	}
	return rec, nil
}
