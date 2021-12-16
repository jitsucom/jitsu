package schema

import (
	"bytes"
	"fmt"
	"github.com/jitsucom/jitsu/server/typing"
	"github.com/xitongsys/parquet-go-source/writerfile"
	"github.com/xitongsys/parquet-go/parquet"
	"github.com/xitongsys/parquet-go/types"
	"github.com/xitongsys/parquet-go/writer"
	"time"
)

func NewParquetMarshaller(useGZIP bool) StronglyTypedMarshaller {
	pm := &ParquetMarshaller{
		GoroutinesCount: 2,
		UseGZIP:         useGZIP,
	}
	return pm
}

type ParquetMarshaller struct {
	GoroutinesCount int64
	UseGZIP         bool
}

type parquetMetadataItem struct {
	index int
	dataType typing.DataType
	defaultValue interface{}
}

func (pm *ParquetMarshaller) Marshal(bh *BatchHeader, data []map[string]interface{}) ([]byte, error) {
	parquetSchema, meta, err := pm.parquetMetadata(bh)
	if err != nil {
		return nil, fmt.Errorf("can't generate parquet type metadata: %v", err)
	}
	buf := new(bytes.Buffer)
	fw := writerfile.NewWriterFile(buf)
	defer fw.Close()
	pw, err := writer.NewCSVWriter(parquetSchema, fw, pm.GoroutinesCount)
	if pm.UseGZIP {
		pw.CompressionType = parquet.CompressionCodec_GZIP
	}
	if err != nil {
		return nil, fmt.Errorf("can't create parquet writer: %v", err)
	}
	for _, obj := range data {
		parquetRec, err := pm.parquetRecord(meta, obj)
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

func (pm *ParquetMarshaller) parquetMetadata(bh *BatchHeader) ([]string, map[string]parquetMetadataItem, error) {
	parquetSchema := make([]string, 0, len(bh.Fields))
	meta := make(map[string]parquetMetadataItem, len(bh.Fields))
	i := 0
	for field, fieldMeta := range bh.Fields {
		if fieldMeta.dataType == nil {
			return nil, nil, fmt.Errorf("field %s has nil data type", field)
		}
		switch *fieldMeta.dataType {
		case typing.BOOL:
			parquetSchema = append(parquetSchema, fmt.Sprintf("name=%s, type=BOOLEAN", field))
			meta[field] = parquetMetadataItem{i,typing.BOOL, false}
		case typing.INT64:
			parquetSchema = append(parquetSchema, fmt.Sprintf("name=%s, type=INT64", field))
			meta[field] = parquetMetadataItem{i,typing.INT64, int64(0)}
		case typing.FLOAT64:
			parquetSchema = append(parquetSchema, fmt.Sprintf("name=%s, type=DOUBLE", field))
			meta[field] = parquetMetadataItem{i,typing.FLOAT64, float64(0)}
		case typing.STRING:
			parquetSchema = append(parquetSchema, fmt.Sprintf("name=%s, type=BYTE_ARRAY, convertedtype=UTF8, encoding=PLAIN_DICTIONARY", field))
			meta[field] = parquetMetadataItem{i,typing.STRING, ""}
		case typing.TIMESTAMP:
			parquetSchema = append(parquetSchema, fmt.Sprintf("name=%s, type=INT64, logicaltype=TIMESTAMP, logicaltype.isadjustedtoutc=true, logicaltype.unit=MILLIS", field))
			meta[field] = parquetMetadataItem{i,typing.TIMESTAMP, time.Time{}}
		// UNKNOWN and default
		default:
			return nil, nil, fmt.Errorf("field %s has unmappable data type", field)
		}
		i++
	}
	return parquetSchema, meta, nil
}

func (pm *ParquetMarshaller) parquetRecord(meta map[string]parquetMetadataItem, obj map[string]interface{}) ([]interface{}, error) {
	rec := make([]interface{}, len(meta))
	for field, metaItem := range meta {
		fieldValue, ok := obj[field]
		if !ok || fieldValue == nil {
			fieldValue = metaItem.defaultValue
		}
		switch metaItem.dataType {
		case typing.BOOL, typing.INT64, typing.FLOAT64, typing.STRING:
			rec[metaItem.index] = fieldValue
		case typing.TIMESTAMP:
			t, err := typing.ParseTimestamp(fieldValue)
			if err != nil {
				return nil, err
			}
			if t.IsZero() {
				rec[metaItem.index] = int64(0)
			} else {
				rec[metaItem.index] = types.TimeToTIMESTAMP_MILLIS(t, true)
			}
		// UNKNOWN and default
		default:
			return nil, fmt.Errorf("field %s has unsupported data type %v", field, metaItem.dataType)
		}
	}
	return rec, nil
}
