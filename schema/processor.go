package schema

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"github.com/ksensehq/eventnative/timestamp"
	"io"
	"log"
	"reflect"
	"text/template"
	"time"
)

type Processor struct {
	fieldMapper          Mapper
	tableNameExtractFunc TableNameExtractFunction
}

type ProcessedFile struct {
	FileName   string
	Payload    *bytes.Buffer
	DataSchema *Table
}

func NewProcessor(tableNameFuncExpression string, mappings []string) (*Processor, error) {
	mapper, err := NewFieldMapper(mappings)
	if err != nil {
		return nil, err
	}

	tmpl, err := template.New("table name extract").
		Option("missingkey=error").
		Parse(tableNameFuncExpression)
	if err != nil {
		return nil, fmt.Errorf("Error parsing table name template %v", err)
	}

	tableNameExtractFunc := func(object map[string]interface{}) (string, error) {
		//we need time type of _timestamp field for extracting table name with date template
		ts, ok := object[timestamp.Key]
		if !ok {
			return "", fmt.Errorf("Error extracting table name: %s field doesn't exist", timestamp.Key)
		}
		t, err := time.Parse(timestamp.Layout, ts.(string))
		if err != nil {
			return "", fmt.Errorf("Error extracting table name: malformed %s field: %v", timestamp.Key, err)
		}

		object[timestamp.Key] = t
		var buf bytes.Buffer
		if err := tmpl.Execute(&buf, object); err != nil {
			return "", fmt.Errorf("Error executing %s template: %v", tableNameFuncExpression, err)
		}

		return buf.String(), nil
	}

	return &Processor{fieldMapper: mapper, tableNameExtractFunc: tableNameExtractFunc}, nil
}

//Process file payload lines divided with \n. Line by line where 1 line = 1 json
//Return json byte payload contained 1 line = 1 json with \n delimiter
//Every json byte payload for different table like {"table1": payload, "table2": payload}
func (p *Processor) Process(fileName string, payload []byte, breakOnError bool) (map[string]*ProcessedFile, error) {
	filePerTable := map[string]*ProcessedFile{}
	input := bytes.NewBuffer(payload)
	reader := bufio.NewReaderSize(input, 64*1024)
	line, readErr := reader.ReadBytes('\n')

	for readErr == nil {
		table, processedObject, err := p.processObject(line)
		if err != nil {
			if breakOnError {
				return nil, err
			} else {
				log.Printf("Warn: unable to process object %s reason: %v. This line will be skipped", string(line), err)
			}
		}

		//don't process empty object
		if table.Exists() {
			f, ok := filePerTable[table.Name]
			if !ok {
				f := &ProcessedFile{FileName: fileName, DataSchema: table, Payload: bytes.NewBuffer(processedObject)}
				filePerTable[table.Name] = f
			} else {
				f.DataSchema.Columns.Merge(table.Columns)
				f.Payload.Write([]byte("\n"))
				f.Payload.Write(processedObject)
			}
		}

		line, readErr = reader.ReadBytes('\n')
		if readErr != nil && readErr != io.EOF {
			log.Printf("Error reading line in [%s] file", fileName)
		}
	}

	return filePerTable, nil
}

//Flatten all json keys from /key1/key2 to key1_key2 and apply mappings
//Return table representation of object and object json bytes
func (p *Processor) processObject(line []byte) (*Table, []byte, error) {
	object := map[string]interface{}{}

	err := json.Unmarshal(line, &object)
	if err != nil {
		return nil, nil, err
	}

	flatObject, err := p.flattenObject(object)
	if err != nil {
		return nil, nil, err
	}

	tableName, err := p.tableNameExtractFunc(flatObject)
	if err != nil {
		return nil, nil, fmt.Errorf("Error extracting table name from object {%v}: %v", flatObject, err)
	}
	if tableName == "" {
		return nil, nil, fmt.Errorf("Unknown table name. Object {%v}", flatObject)
	}

	mappedObject := p.fieldMapper.Map(flatObject)

	objectBytes, err := json.Marshal(mappedObject)
	if err != nil {
		return nil, nil, err
	}

	table := &Table{Name: tableName, Columns: Columns{}}
	for k := range mappedObject {
		table.Columns[k] = Column{Type: STRING}
	}

	return table, objectBytes, nil
}

//Return flatten object e.g. from {"key1":{"key2":123}} to {"key1_key2":123}
func (p *Processor) flattenObject(json map[string]interface{}) (map[string]interface{}, error) {
	flattenMap := make(map[string]interface{})

	err := p.flatten("", json, flattenMap)
	if err != nil {
		return nil, err
	}

	return flattenMap, nil

}

//omit nil values
func (p *Processor) flatten(key string, value interface{}, destination map[string]interface{}) error {
	t := reflect.ValueOf(value)
	switch t.Kind() {
	case reflect.Slice:
		b, err := json.Marshal(value)
		if err != nil {
			return fmt.Errorf("Error marshaling array with key %s: %v", key, err)
		}
		destination[key] = string(b)
	case reflect.Map:
		unboxed := value.(map[string]interface{})
		for k, v := range unboxed {
			newKey := k
			if key != "" {
				newKey = key + "_" + newKey
			}
			if err := p.flatten(newKey, v, destination); err != nil {
				return fmt.Errorf("Error flatten object with key %s_%s: %v", key, k, err)
			}
		}
	default:
		if value != nil {
			destination[key] = fmt.Sprintf("%v", value)
		}
	}

	return nil
}
