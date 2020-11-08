package schema

import (
	"bufio"
	"bytes"
	"fmt"
	"github.com/jitsucom/eventnative/events"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/parsers"
	"github.com/jitsucom/eventnative/timestamp"
	"github.com/jitsucom/eventnative/typing"
	"io"
	"strings"
	"text/template"
	"time"
)

type Processor struct {
	flattener            *Flattener
	fieldMapper          Mapper
	typeCasts            map[string]typing.DataType
	tableNameExtractFunc TableNameExtractFunction
}

func NewProcessor(tableNameFuncExpression string, mappings []string, mappingType FieldMappingType) (*Processor, error) {
	mapper, typeCasts, err := NewFieldMapper(mappingType, mappings)
	if err != nil {
		return nil, err
	}

	if typeCasts == nil {
		typeCasts = map[string]typing.DataType{}
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

		//revert type of _timestamp field
		object[timestamp.Key] = ts

		// format "Abc dse" -> "abc_dse"
		return strings.ToLower(strings.ReplaceAll(buf.String(), " ", "_")), nil
	}

	return &Processor{
		flattener:            NewFlattener(),
		fieldMapper:          mapper,
		typeCasts:            typeCasts,
		tableNameExtractFunc: tableNameExtractFunc}, nil
}

//ProcessFact return table representation, processed flatten object
func (p *Processor) ProcessFact(fact events.Fact) (*Table, map[string]interface{}, error) {
	return p.processObject(fact)
}

//ProcessFilePayload process file payload lines divided with \n. Line by line where 1 line = 1 json
//Return array of processed objects per table like {"table1": []objects, "table2": []objects}
func (p *Processor) ProcessFilePayload(fileName string, payload []byte, breakOnError bool) (map[string]*ProcessedFile, error) {
	filePerTable := map[string]*ProcessedFile{}
	input := bytes.NewBuffer(payload)
	reader := bufio.NewReaderSize(input, 64*1024)
	line, readErr := reader.ReadBytes('\n')

	for readErr == nil {
		table, processedObject, err := p.processLine(line)
		if err != nil {
			if breakOnError {
				return nil, err
			} else {
				logging.Warnf("Unable to process object %s reason: %v. This line will be skipped", string(line), err)
			}
		}

		//don't process empty object
		if table.Exists() {
			f, ok := filePerTable[table.Name]
			if !ok {
				filePerTable[table.Name] = &ProcessedFile{FileName: fileName, DataSchema: table, payload: []map[string]interface{}{processedObject}}
			} else {
				f.DataSchema.Columns.Merge(table.Columns)
				f.payload = append(f.payload, processedObject)
			}
		}

		line, readErr = reader.ReadBytes('\n')
		if readErr != nil && readErr != io.EOF {
			logging.Errorf("Error reading line in [%s] file", fileName)
		}
	}

	return filePerTable, nil
}

//ProcessObjects process source chunk payload objects
//Return array of processed objects per table like {"table1": []objects, "table2": []objects}
func (p *Processor) ProcessObjects(objects []map[string]interface{}, breakOnError bool) (map[string]*ProcessedFile, error) {
	unitPerTable := map[string]*ProcessedFile{}

	for _, object := range objects {
		table, processedObject, err := p.processObject(object)
		if err != nil {
			return nil, err
		}

		//don't process empty object
		if !table.Exists() {
			continue
		}

		unit, ok := unitPerTable[table.Name]
		if !ok {
			unitPerTable[table.Name] = &ProcessedFile{DataSchema: table, payload: []map[string]interface{}{processedObject}}
		} else {
			unit.DataSchema.Columns.Merge(table.Columns)
			unit.payload = append(unit.payload, processedObject)
		}
	}

	return unitPerTable, nil
}

//ApplyDBTyping call ApplyDBTypingToObject to every object in input *ProcessedFile payload
//return err if can't convert any field to DB schema type
func (p *Processor) ApplyDBTyping(dbSchema *Table, pf *ProcessedFile) error {
	for _, object := range pf.payload {
		if err := p.ApplyDBTypingToObject(dbSchema, object); err != nil {
			return err
		}
	}

	return nil
}

//ApplyDBTypingToObject convert all object fields to DB schema types
//change input object
//return err if can't convert any field to DB schema type
func (p *Processor) ApplyDBTypingToObject(dbSchema *Table, object map[string]interface{}) error {
	for k, v := range object {
		column := dbSchema.Columns[k]
		converted, err := typing.Convert(column.GetType(), v)
		if err != nil {
			return fmt.Errorf("Error applying DB type [%s] to input [%s] field with [%v] value: %v", column.GetType(), k, v, err)
		}
		object[k] = converted
	}

	return nil
}

//Return table representation of object and flatten object from file line
func (p *Processor) processLine(line []byte) (*Table, map[string]interface{}, error) {
	object, err := parsers.ParseJson(line)
	if err != nil {
		return nil, nil, err
	}

	table, flattenObject, err := p.processObject(object)
	if err != nil {
		return nil, nil, err
	}

	return table, flattenObject, nil
}

//Return table representation of object and flatten, mapped object
//1. remove toDelete fields from object
//2. flatten object
//3. map object
//4. apply typecast
func (p *Processor) processObject(object map[string]interface{}) (*Table, map[string]interface{}, error) {
	mappedObject, err := p.fieldMapper.Map(object)
	if err != nil {
		return nil, nil, fmt.Errorf("Error mapping object {%v}: %v", object, err)
	}

	flatObject, err := p.flattener.FlattenObject(mappedObject)
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

	table := &Table{Name: tableName, Columns: Columns{}}

	//apply typecast and define column types
	//mapping typecast overrides default typecast
	for k, v := range flatObject {
		//reformat from json.Number into int64 or float64 and put back
		v = typing.ReformatValue(v)
		flatObject[k] = v
		//value type
		resultColumnType, err := typing.TypeFromValue(v)
		if err != nil {
			return nil, nil, fmt.Errorf("Error getting type of field [%s]: %v", k, err)
		}

		//default typecast
		if defaultType, ok := typing.DefaultTypes[k]; ok {
			converted, err := typing.Convert(defaultType, v)
			if err != nil {
				return nil, nil, fmt.Errorf("Error default converting field [%s]: %v", k, err)
			}

			resultColumnType = defaultType
			flatObject[k] = converted
		}

		//mapping typecast
		if toType, ok := p.typeCasts[k]; ok {
			converted, err := typing.Convert(toType, v)
			if err != nil {
				strType, getStrErr := typing.StringFromType(toType)
				if getStrErr != nil {
					strType = getStrErr.Error()
				}
				return nil, nil, fmt.Errorf("Error converting field [%s] to [%s]: %v", k, strType, err)
			}

			resultColumnType = toType
			flatObject[k] = converted
		}

		table.Columns[k] = NewColumn(resultColumnType)
	}

	return table, flatObject, nil
}
