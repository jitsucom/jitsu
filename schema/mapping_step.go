package schema

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"github.com/jitsucom/eventnative/enrichment"
	"github.com/jitsucom/eventnative/events"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/maputils"
	"github.com/jitsucom/eventnative/timestamp"
	"github.com/jitsucom/eventnative/typing"
	"io"
	"strings"
	"text/template"
	"time"
)

var ErrSkipObject = errors.New("Table name template return empty string. This object will be skipped.")

type TableNameExtractFunction func(map[string]interface{}) (string, error)

type MappingStep struct {
	identifier           string
	flattener            *Flattener
	fieldMapper          Mapper
	tableNameExtractFunc TableNameExtractFunction
	tableNameExpression  string
	enrichmentRules      []enrichment.Rule
	breakOnError         bool
}

func NewMappingStep(identifier, tableNameFuncExpression string, fieldMapper Mapper, enrichmentRules []enrichment.Rule, breakOnError bool) (*MappingStep, error) {

	flattener := NewFlattener()

	//Table naming
	tmpl, err := template.New("table name extract").
		Parse(tableNameFuncExpression)
	if err != nil {
		return nil, fmt.Errorf("Error parsing table name template %v", err)
	}

	tableNameExtractFunc := func(object map[string]interface{}) (result string, err error) {
		//panic handler
		defer func() {
			if r := recover(); r != nil {
				result = ""
				err = fmt.Errorf("Error getting table name with expression %s: %v", tableNameFuncExpression, r)
			}
		}()

		//we need time type of _timestamp field for extracting table name with date template
		ts, ok := object[timestamp.Key]
		if !ok {
			errMsg := fmt.Sprintf("Error extracting table name: %s field doesn't exist", timestamp.Key)
			logging.SystemError(errMsg)
			return "", errors.New(errMsg)
		}
		t, err := time.Parse(timestamp.Layout, ts.(string))
		if err != nil {
			errMsg := fmt.Sprintf("Error extracting table name: malformed %s field: %v", timestamp.Key, err)
			logging.SystemError(errMsg)
			return "", errors.New(errMsg)
		}

		object[timestamp.Key] = t
		var buf bytes.Buffer
		if err := tmpl.Execute(&buf, object); err != nil {
			return "", fmt.Errorf("Error executing %s template: %v", tableNameFuncExpression, err)
		}

		// format "<no value>" -> null
		formatted := strings.ReplaceAll(buf.String(), "<no value>", "null")
		// format "Abc dse" -> "abc_dse"
		return flattener.Reformat(formatted), nil
	}

	return &MappingStep{
		identifier:           identifier,
		flattener:            flattener,
		fieldMapper:          fieldMapper,
		tableNameExtractFunc: tableNameExtractFunc,
		tableNameExpression:  tableNameFuncExpression,
		enrichmentRules:      enrichmentRules,
		breakOnError:         breakOnError,
	}, nil
}

//ProcessEvent return table representation, processed flatten object
func (p *MappingStep) ProcessEvent(event map[string]interface{}) (*BatchHeader, events.Event, error) {
	return p.processObject(event, map[string]bool{})
}

//ProcessFilePayload process file payload lines divided with \n. Line by line where 1 line = 1 json
//Return array of processed objects per table like {"table1": []objects, "table2": []objects},
//All failed events are moved to separate collection for sending to fallback
func (p *MappingStep) ProcessFilePayload(fileName string, payload []byte, alreadyUploadedTables map[string]bool,
	parseFunc func([]byte) (map[string]interface{}, error)) (map[string]*ProcessedFile, []*events.FailedEvent, error) {
	var failedFacts []*events.FailedEvent
	filePerTable := map[string]*ProcessedFile{}

	input := bytes.NewBuffer(payload)
	reader := bufio.NewReaderSize(input, 64*1024)
	line, readErr := reader.ReadBytes('\n')

	for readErr == nil {
		object, err := parseFunc(line)
		if err != nil {
			return nil, nil, err
		}

		batchHeader, processedObject, err := p.processObject(object, alreadyUploadedTables)
		if err != nil {
			//handle skip object functionality
			if err == ErrSkipObject {
				logging.Warnf("[%s] Event [%s]: %v", p.identifier, events.ExtractEventId(object), err)
			} else if p.breakOnError {
				return nil, nil, err
			} else {
				logging.Warnf("Unable to process object %s: %v. This line will be stored in fallback.", string(line), err)

				failedFacts = append(failedFacts, &events.FailedEvent{
					//remove last byte (\n)
					Event:   line[:len(line)-1],
					Error:   err.Error(),
					EventId: events.ExtractEventId(object),
				})
			}
		}

		//don't process empty and skipped object
		if batchHeader.Exists() {
			f, ok := filePerTable[batchHeader.TableName]
			if !ok {
				filePerTable[batchHeader.TableName] = &ProcessedFile{FileName: fileName, BatchHeader: batchHeader, payload: []map[string]interface{}{processedObject}}
			} else {
				f.BatchHeader.Fields.Merge(batchHeader.Fields)
				f.payload = append(f.payload, processedObject)
			}
		}

		line, readErr = reader.ReadBytes('\n')
		if readErr != nil && readErr != io.EOF {
			return nil, nil, fmt.Errorf("Error reading line in [%s] file: %v", fileName, readErr)
		}
	}

	return filePerTable, failedFacts, nil
}

//ProcessObjects process source chunk payload objects
//Return array of processed objects per table like {"table1": []objects, "table2": []objects}
//If at least 1 error occurred - this method return it
func (p *MappingStep) ProcessObjects(objects []map[string]interface{}) (map[string]*ProcessedFile, error) {
	unitPerTable := map[string]*ProcessedFile{}

	for _, object := range objects {
		batchHeader, processedObject, err := p.processObject(object, map[string]bool{})
		if err != nil {
			return nil, err
		}

		//don't process empty object
		if !batchHeader.Exists() {
			continue
		}

		unit, ok := unitPerTable[batchHeader.TableName]
		if !ok {
			unitPerTable[batchHeader.TableName] = &ProcessedFile{BatchHeader: batchHeader, payload: []map[string]interface{}{processedObject}}
		} else {
			unit.BatchHeader.Fields.Merge(batchHeader.Fields)
			unit.payload = append(unit.payload, processedObject)
		}
	}

	return unitPerTable, nil
}

//Check if table name in skipTables => return empty Table for skipping or
//Return table representation of object and flatten, mapped object
//1. copy map and don't change input object
//2. execute default and configured enrichment rules
//3. remove toDelete fields from object
//4. map object
//5. flatten object
//6. apply default typecasts
//
//or ErrSkipObject/another error
func (p *MappingStep) processObject(object map[string]interface{}, alreadyUploadedTables map[string]bool) (*BatchHeader, map[string]interface{}, error) {
	tableName, err := p.tableNameExtractFunc(object)
	if err != nil {
		return nil, nil, fmt.Errorf("Error extracting table name. Template: %s: %v", p.tableNameExpression, err)
	}
	if tableName == "" {
		return nil, nil, ErrSkipObject
	}

	//object has been already processed (storage:table pair might be already processed)
	_, ok := alreadyUploadedTables[tableName]
	if ok {
		return &BatchHeader{}, nil, nil
	}

	objectCopy := maputils.CopyMap(object)
	for _, rule := range p.enrichmentRules {
		rule.Execute(objectCopy)
	}

	batchHeader := &BatchHeader{TableName: tableName, Fields: Fields{}}

	mappedObject, err := p.fieldMapper.Map(objectCopy)
	if err != nil {
		return nil, nil, fmt.Errorf("Error mapping object: %v", err)
	}

	flatObject, err := p.flattener.FlattenObject(mappedObject)
	if err != nil {
		return nil, nil, err
	}

	//apply default typecast and define column types
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

		batchHeader.Fields[k] = NewField(resultColumnType)
	}

	return batchHeader, flatObject, nil
}
