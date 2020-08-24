package schema

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"github.com/ksensehq/eventnative/events"
	"github.com/ksensehq/eventnative/timestamp"
	"github.com/ksensehq/eventnative/typing"
	"io"
	"log"
	"text/template"
	"time"
)

type Processor struct {
	flattener            *Flattener
	fieldMapper          Mapper
	typeCasts            map[string]typing.DataType
	tableNameExtractFunc TableNameExtractFunction
}

func NewProcessor(tableNameFuncExpression string, mappings []string) (*Processor, error) {
	mapper, typeCasts, err := NewFieldMapper(mappings)
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

		return buf.String(), nil
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
				log.Printf("Warn: unable to process object %s reason: %v. This line will be skipped", string(line), err)
			}
		}

		//don't process empty object
		if table.Exists() {
			f, ok := filePerTable[table.Name]
			if !ok {
				filePerTable[table.Name] = &ProcessedFile{FileName: fileName, DataSchema: table, payload: []map[string]interface{}{processedObject}}
			} else {
				var objectErr error
				//if existing column type was changed -> convert new column type to existing one
				for _, columnDiff := range f.DataSchema.Columns.TypesDiff(table.Columns) {
					v := processedObject[columnDiff.ColumnName]
					converted, err := typing.Convert(columnDiff.CurrentType, v)
					if err != nil {
						if breakOnError {
							return nil, err
						} else {
							log.Printf("Warn: field [%s] has changed type from [%s] to [%s] in object %s Converting err: %v. This line will be skipped",
								columnDiff.ColumnName, columnDiff.CurrentType.String(), columnDiff.IncomingType.String(), string(line), err)
							objectErr = err
							break
						}
					}
					//replace value, type -> converted value, type
					processedObject[columnDiff.ColumnName] = converted
					table.Columns[columnDiff.ColumnName] = Column{Type: columnDiff.CurrentType}
				}

				//include ok object to the result (skip err objects)
				if objectErr == nil {
					f.DataSchema.Columns.Merge(table.Columns)
					f.payload = append(f.payload, processedObject)
				}
			}
		}

		line, readErr = reader.ReadBytes('\n')
		if readErr != nil && readErr != io.EOF {
			log.Printf("Error reading line in [%s] file", fileName)
		}
	}

	return filePerTable, nil
}

//Return table representation of object and flatten object from file line
func (p *Processor) processLine(line []byte) (*Table, map[string]interface{}, error) {
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

//Return table representation of object and flatten, mapped object
//1. remove toDelete fields from object
//2. flatten object
//3. map object
//4. apply typecast
func (p *Processor) processObject(object map[string]interface{}) (*Table, map[string]interface{}, error) {
	processed := p.fieldMapper.ApplyDelete(object)

	flatObject, err := p.flattener.FlattenObject(processed)
	if err != nil {
		return nil, nil, err
	}

	mappedObject, err := p.fieldMapper.Map(flatObject)
	if err != nil {
		return nil, nil, fmt.Errorf("Error mapping object {%v}: %v", flatObject, err)
	}

	tableName, err := p.tableNameExtractFunc(mappedObject)
	if err != nil {
		return nil, nil, fmt.Errorf("Error extracting table name from object {%v}: %v", mappedObject, err)
	}
	if tableName == "" {
		return nil, nil, fmt.Errorf("Unknown table name. Object {%v}", mappedObject)
	}

	table := &Table{Name: tableName, Columns: Columns{}}

	//apply typecast and define column types
	//mapping typecast overrides default typecast
	for k, v := range mappedObject {
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
			mappedObject[k] = converted
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
			mappedObject[k] = converted
		}

		table.Columns[k] = Column{Type: resultColumnType}
	}

	return table, mappedObject, nil
}
