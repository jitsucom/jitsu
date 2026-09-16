package types

import (
	"bufio"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"github.com/hamba/avro/v2/ocf"
	"github.com/jitsucom/bulker/jitsubase/jsonorder"
	"io"
)

const quotaByteValue = 34

// klauspost/gzip and compress/gzip do not produce the same output at the same
// nominal level. 6 here is the match for the stdlib level 4 it replaces: 4.4%
// smaller and 25% cheaper to produce. klauspost at level 4 would be 9.5% *larger*
// than what we used to emit, so do not "optimise" this back down.
const gzipLevel = 6

type Marshaller interface {
	Init(writer io.Writer, header []string) error
	InitSchema(writer io.Writer, columns []string, table *AvroSchema) error
	Marshal(...Object) error
	Flush() error
	NeedHeader() bool
	Format() FileFormat
	Compression() FileCompression
	Equal(Marshaller) bool
	FileExtension() string
}

type AbstractMarshaller struct {
	format      FileFormat
	compression FileCompression
}

func (am *AbstractMarshaller) Equal(m Marshaller) bool {
	return am.format == m.Format() && am.compression == m.Compression()
}

func NewMarshaller(format FileFormat, compression FileCompression) (Marshaller, error) {
	switch format {
	case FileFormatCSV:
		return &CSVMarshaller{AbstractMarshaller: AbstractMarshaller{format: format, compression: compression}}, nil
	case FileFormatNDJSON, FileFormatNDJSONFLAT:
		return &JSONMarshaller{AbstractMarshaller: AbstractMarshaller{format: format, compression: compression}}, nil
	case FileFormatAVRO:
		return &AvroMarshaller{AbstractMarshaller: AbstractMarshaller{format: format, compression: compression}}, nil
	case FileFormatJSONArray:
		return &JSONArrayMarshaller{AbstractMarshaller: AbstractMarshaller{format: format, compression: compression}}, nil
	default:
		return nil, fmt.Errorf("Unknown file format: %s", format)
	}
}

type JSONMarshaller struct {
	AbstractMarshaller
	writer     io.Writer
	compressor io.Closer
	bufWriter  *bufio.Writer
	encoder    *jsonorder.Encoder
}

func (jm *JSONMarshaller) Init(writer io.Writer, _ []string) error {
	if jm.writer == nil {
		w, compressor, err := wrapCompression(jm.compression, writer)
		if err != nil {
			return err
		}
		jm.writer, jm.compressor = w, compressor
		jm.bufWriter = bufio.NewWriterSize(jm.writer, 100*1024)
		jm.encoder = jsonorder.NewEncoder(jm.bufWriter)
		jm.encoder.SetEscapeHTML(false)
	}
	return nil
}

func (jm *JSONMarshaller) InitSchema(writer io.Writer, columns []string, table *AvroSchema) error {
	return jm.Init(writer, nil)
}

// Marshal object as json
func (jm *JSONMarshaller) Marshal(object ...Object) error {
	if jm.writer == nil {
		return fmt.Errorf("marshaller wasn't initialized. Run Init() first")
	}
	for _, obj := range object {
		err := jm.encoder.Encode(obj)
		if err != nil {
			return err
		}
	}
	return nil
}

func (jm *JSONMarshaller) Flush() error {
	if jm.writer == nil {
		return fmt.Errorf("marshaller wasn't initialized. Run Init() first")
	}
	err := jm.bufWriter.Flush()
	if err != nil {
		return err
	}
	if jm.compressor != nil {
		return jm.compressor.Close()
	}
	return nil
}

func (jm *JSONMarshaller) NeedHeader() bool {
	return false
}

func (jm *JSONMarshaller) Format() FileFormat {
	return jm.format
}

func (jm *JSONMarshaller) Compression() FileCompression {
	return jm.compression
}

func (jm *JSONMarshaller) FileExtension() string {
	return ".ndjson" + CompressionExtension(jm.compression)
}

type JSONArrayMarshaller struct {
	AbstractMarshaller
	writer     io.Writer
	compressor io.Closer
	bufWriter  *bufio.Writer
	needComma  bool
}

func (ja *JSONArrayMarshaller) Init(writer io.Writer, _ []string) error {
	if ja.writer == nil {
		w, compressor, err := wrapCompression(ja.compression, writer)
		if err != nil {
			return err
		}
		ja.writer, ja.compressor = w, compressor
		ja.bufWriter = bufio.NewWriterSize(ja.writer, 100*1024)
		_, _ = ja.bufWriter.WriteString("[")
	}
	return nil
}

func (ja *JSONArrayMarshaller) InitSchema(writer io.Writer, columns []string, table *AvroSchema) error {
	return ja.Init(writer, nil)
}

// Marshal object as json
func (ja *JSONArrayMarshaller) Marshal(object ...Object) error {
	if ja.writer == nil {
		return fmt.Errorf("marshaller wasn't initialized. Run Init() first")
	}
	for _, obj := range object {
		if ja.needComma {
			_ = ja.bufWriter.WriteByte(',')
		}
		b, err := jsonorder.Marshal(obj)
		if err != nil {
			return err
		}
		_, err = ja.bufWriter.Write(b)
		if err != nil {
			return err
		}
		ja.needComma = true
	}
	return nil
}

func (ja *JSONArrayMarshaller) Flush() error {
	if ja.writer == nil {
		return fmt.Errorf("marshaller wasn't initialized. Run Init() first")
	}
	_ = ja.bufWriter.WriteByte(']')
	err := ja.bufWriter.Flush()
	if err != nil {
		return err
	}
	if ja.compressor != nil {
		return ja.compressor.Close()
	}
	return nil
}

func (ja *JSONArrayMarshaller) NeedHeader() bool {
	return false
}

func (ja *JSONArrayMarshaller) Format() FileFormat {
	return ja.format
}

func (ja *JSONArrayMarshaller) Compression() FileCompression {
	return ja.compression
}

func (ja *JSONArrayMarshaller) FileExtension() string {
	return ".json" + CompressionExtension(ja.compression)
}

type CSVMarshaller struct {
	AbstractMarshaller
	writer     *csv.Writer
	compressor io.Closer
	fields     []string
}

func (cm *CSVMarshaller) Init(writer io.Writer, header []string) error {
	if cm.writer == nil {
		w, compressor, err := wrapCompression(cm.compression, writer)
		if err != nil {
			return err
		}
		cm.compressor = compressor
		cm.writer = csv.NewWriter(w)
		cm.fields = header
		if err := cm.writer.Write(header); err != nil {
			return err
		}
	}
	return nil
}

func (cm *CSVMarshaller) InitSchema(writer io.Writer, columns []string, table *AvroSchema) error {
	return cm.Init(writer, columns)
}

// Marshal marshals input object as csv values string with delimiter
func (cm *CSVMarshaller) Marshal(object ...Object) error {
	if cm.writer == nil {
		return fmt.Errorf("marshaller wasn't initialized. Run Init() first")
	}
	valuesArr := make([]string, len(cm.fields))
	for _, obj := range object {
		for i, field := range cm.fields {
			v := obj.GetN(field)
			strValue := ""
			if v == nil {
				strValue = ""
			} else {
				switch v := v.(type) {
				case string:
					strValue = v
				case bool:
					if v {
						strValue = "1"
					} else {
						strValue = "0"
					}
				default:
					//use json marshaller to marshal types like arrays and time in unified way
					b, err := jsonorder.Marshal(v)
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
			valuesArr[i] = strValue
		}
		//logging.Info("Writing values: ", valuesArr)
		err := cm.writer.Write(valuesArr)
		if err != nil {
			return err
		}
	}
	return nil
}

func (cm *CSVMarshaller) NeedHeader() bool {
	return true
}

func (cm *CSVMarshaller) Format() FileFormat {
	return cm.format
}

func (cm *CSVMarshaller) Compression() FileCompression {
	return cm.compression
}

func (cm *CSVMarshaller) Flush() error {
	if cm.writer == nil {
		return fmt.Errorf("marshaller wasn't initialized. Run Init() first")
	}
	cm.writer.Flush()
	if cm.compressor != nil {
		return cm.compressor.Close()
	}
	return nil
}

func (cm *CSVMarshaller) FileExtension() string {
	return ".csv" + CompressionExtension(cm.compression)
}

type FileFormat string

const (
	FileFormatCSV        FileFormat = "csv"
	FileFormatAVRO       FileFormat = "avro"
	FileFormatNDJSON     FileFormat = "ndjson"
	FileFormatNDJSONFLAT FileFormat = "ndjson_flat"
	FileFormatJSONArray  FileFormat = "json"
)

type FileCompression string

const (
	FileCompressionGZIP    FileCompression = "gzip"
	FileCompressionZSTD    FileCompression = "zstd"
	FileCompressionNONE    FileCompression = "none"
	FileCompressionUNKNOWN FileCompression = ""
)

type AvroMarshaller struct {
	AbstractMarshaller
	schema  *AvroSchema
	encoder *ocf.Encoder
}

func (a *AvroMarshaller) Init(writer io.Writer, header []string) error {
	return fmt.Errorf("Avro marshaller doesn't support Init methodut table w/o schema")
}

func (a *AvroMarshaller) InitSchema(writer io.Writer, columns []string, table *AvroSchema) error {
	avroSchemaStr, _ := json.Marshal(table)
	//fmt.Println("Avro schema: ", string(avroSchemaStr))
	enc, err := ocf.NewEncoder(string(avroSchemaStr), writer, ocf.WithCodec(ocf.Snappy))
	if err != nil {
		return err
	}
	a.schema = table
	a.encoder = enc

	return nil
}

// Marshal marshals input object as csv values string with delimiter
func (a *AvroMarshaller) Marshal(object ...Object) error {
	for _, obj := range object {
		for el := obj.Front(); el != nil; el = el.Next() {
			k := el.Key
			dt := a.schema.DataTypes[k]
			//fmt.Println("Avro marshaller: ", k, v, dt)
			cv, ok, _ := Convert(dt, el.Value)
			if ok {
				el.Value = cv
			}
		}
		err := a.encoder.Encode(obj)
		if err != nil {
			return err
		}
	}
	return nil
}

func (a *AvroMarshaller) NeedHeader() bool {
	return true
}

func (a *AvroMarshaller) Format() FileFormat {
	return a.format
}

func (a *AvroMarshaller) Compression() FileCompression {
	return FileCompressionNONE
}

func (a *AvroMarshaller) Flush() error {
	return a.encoder.Close()
}

func (a *AvroMarshaller) FileExtension() string {
	return ".avro"
}
