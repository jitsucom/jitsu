package schema

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"github.com/ksensehq/eventnative/events"
	"github.com/ksensehq/eventnative/timestamp"
	"io"
	"log"
	"text/template"
	"time"
)

type ProcessedFileBytes struct {
	FileName   string
	Payload    *bytes.Buffer
	DataSchema *Table
}

type ProcessedFile struct {
	FileName   string
	Payload    []map[string]interface{}
	DataSchema *Table
}

type Processor struct {
	flattener            *Flattener
	fieldMapper          Mapper
	tableNameExtractFunc TableNameExtractFunction
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

	return &Processor{
		flattener:            NewFlattener(),
		fieldMapper:          mapper,
		tableNameExtractFunc: tableNameExtractFunc}, nil
}

//ProcessFact return table representation, processed flatten object
func (p *Processor) ProcessFact(fact events.Fact) (*Table, map[string]interface{}, error) {
	return p.processObject(fact)
}

//ProcessFilePayloadIntoBytes process file payload lines divided with \n. Line by line where 1 line = 1 json
//Return json byte payload contained 1 line = 1 json with \n delimiter
//Every json byte payload for different table like {"table1": payload, "table2": payload}
func (p *Processor) ProcessFilePayloadIntoBytes(fileName string, payload []byte, breakOnError bool) (map[string]*ProcessedFileBytes, error) {
	filePerTable := map[string]*ProcessedFileBytes{}
	input := bytes.NewBuffer(payload)
	reader := bufio.NewReaderSize(input, 64*1024)
	line, readErr := reader.ReadBytes('\n')

	for readErr == nil {
		table, processedObject, err := p.processFileLineIntoBytes(line)
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
				f := &ProcessedFileBytes{FileName: fileName, DataSchema: table, Payload: bytes.NewBuffer(processedObject)}
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

//ProcessFilePayload process file payload lines divided with \n. Line by line where 1 line = 1 json
//Return array of processed objects per table like {"table1": []objects, "table2": []objects}
func (p *Processor) ProcessFilePayload(fileName string, payload []byte, breakOnError bool) (map[string]*ProcessedFile, error) {
	filePerTable := map[string]*ProcessedFile{}
	input := bytes.NewBuffer(payload)
	reader := bufio.NewReaderSize(input, 64*1024)
	line, readErr := reader.ReadBytes('\n')

	for readErr == nil {
		table, processedObject, err := p.processFileLine(line)
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
				f := &ProcessedFile{FileName: fileName, DataSchema: table, Payload: []map[string]interface{}{processedObject}}
				filePerTable[table.Name] = f
			} else {
				f.DataSchema.Columns.Merge(table.Columns)
				f.Payload = append(f.Payload, processedObject)
			}
		}

		line, readErr = reader.ReadBytes('\n')
		if readErr != nil && readErr != io.EOF {
			log.Printf("Error reading line in [%s] file", fileName)
		}
	}

	return filePerTable, nil
}

//Return table representation of object and flatten object bytes from file line
func (p *Processor) processFileLineIntoBytes(line []byte) (*Table, []byte, error) {
	table, object, err := p.processFileLine(line)
	if err != nil {
		return nil, nil, err
	}

	objectBytes, err := json.Marshal(object)
	if err != nil {
		return nil, nil, err
	}

	return table, objectBytes, nil
}

//Return table representation of object and flatten object from file line
func (p *Processor) processFileLine(line []byte) (*Table, map[string]interface{}, error) {
	object := map[string]interface{}{}

	err := json.Unmarshal(line, &object)
	if err != nil {
		return nil, nil, err
	}

	table, flattenObject, err := p.processObject(object)
	if err != nil {
		return nil, nil, err
	}

	return table, flattenObject, nil
}

//Return table representation of object and flatten object
func (p *Processor) processObject(object map[string]interface{}) (*Table, map[string]interface{}, error) {
	flatObject, err := p.flattener.FlattenObject(object)
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

	table := &Table{Name: tableName, Columns: Columns{}}
	for k := range mappedObject {
		//TODO add types
		table.Columns[k] = Column{Type: STRING}
	}

	return table, mappedObject, nil
}
