package schema

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"github.com/jitsucom/eventnative/server/appconfig"
	"github.com/jitsucom/eventnative/server/counters"
	"github.com/jitsucom/eventnative/server/enrichment"
	"github.com/jitsucom/eventnative/server/events"
	"github.com/jitsucom/eventnative/server/logging"
	"github.com/jitsucom/eventnative/server/maputils"
	"io"
)

var ErrSkipObject = errors.New("Table name template return empty string. This object will be skipped.")

type Processor struct {
	identifier           string
	tableNameExtractor   *TableNameExtractor
	lookupEnrichmentStep *enrichment.LookupEnrichmentStep
	mappingStep          *MappingStep
	breakOnError         bool
}

func NewProcessor(destinationId, tableNameFuncExpression string, fieldMapper Mapper, enrichmentRules []enrichment.Rule,
	flattener Flattener, typeResolver TypeResolver, breakOnError bool) (*Processor, error) {
	mappingStep := NewMappingStep(fieldMapper, flattener, typeResolver)
	tableNameExtractor, err := NewTableNameExtractor(tableNameFuncExpression)
	if err != nil {
		return nil, err
	}

	return &Processor{
		identifier:           destinationId,
		tableNameExtractor:   tableNameExtractor,
		lookupEnrichmentStep: enrichment.NewLookupEnrichmentStep(enrichmentRules),
		mappingStep:          mappingStep,
		breakOnError:         breakOnError,
	}, nil
}

//ProcessEvent return table representation, processed flatten object
func (p *Processor) ProcessEvent(event map[string]interface{}) (*BatchHeader, events.Event, error) {
	return p.processObject(event, map[string]bool{})
}

//ProcessFilePayload process file payload lines divided with \n. Line by line where 1 line = 1 json
//Return array of processed objects per table like {"table1": []objects, "table2": []objects},
//All failed events are moved to separate collection for sending to fallback
func (p *Processor) ProcessFilePayload(fileName string, payload []byte, alreadyUploadedTables map[string]bool,
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
				if !appconfig.Instance.DisableSkipEventsWarn {
					logging.Warnf("[%s] Event [%s]: %v", p.identifier, events.ExtractEventId(object), err)
				}

				counters.SkipEvents(p.identifier, 1)
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

		//don't process empty and skipped object (Exists func nil-protected)
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
func (p *Processor) ProcessObjects(objects []map[string]interface{}) (map[string]*ProcessedFile, error) {
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
//1. extract table name
//2. execute enrichment.LookupEnrichmentStep and MappingStep
//or ErrSkipObject/another error
func (p *Processor) processObject(object map[string]interface{}, alreadyUploadedTables map[string]bool) (*BatchHeader, map[string]interface{}, error) {
	tableName, err := p.tableNameExtractor.Extract(object)
	if err != nil {
		return nil, nil, err
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

	p.lookupEnrichmentStep.Execute(objectCopy)

	return p.mappingStep.Execute(tableName, objectCopy)
}
