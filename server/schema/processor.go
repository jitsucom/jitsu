package schema

import (
	"encoding/json"
	"errors"
	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/counters"
	"github.com/jitsucom/jitsu/server/enrichment"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/maputils"
)

var ErrSkipObject = errors.New("Table name template return empty string. This object will be skipped.")

type Processor struct {
	identifier           string
	tableNameExtractor   *TableNameExtractor
	lookupEnrichmentStep *enrichment.LookupEnrichmentStep
	mappingStep          *MappingStep
	breakOnError         bool
}

func NewProcessor(destinationID, tableNameFuncExpression string, fieldMapper Mapper, enrichmentRules []enrichment.Rule,
	flattener Flattener, typeResolver TypeResolver, breakOnError bool) (*Processor, error) {
	mappingStep := NewMappingStep(fieldMapper, flattener, typeResolver)
	tableNameExtractor, err := NewTableNameExtractor(tableNameFuncExpression)
	if err != nil {
		return nil, err
	}

	return &Processor{
		identifier:           destinationID,
		tableNameExtractor:   tableNameExtractor,
		lookupEnrichmentStep: enrichment.NewLookupEnrichmentStep(enrichmentRules),
		mappingStep:          mappingStep,
		breakOnError:         breakOnError,
	}, nil
}

//ProcessEvent returns table representation, processed flatten object
func (p *Processor) ProcessEvent(event map[string]interface{}) (*BatchHeader, events.Event, error) {
	return p.processObject(event, map[string]bool{})
}

//ProcessEvents processes events objects
//returns array of processed objects per table like {"table1": []objects, "table2": []objects},
//All failed events are moved to separate collection for sending to fallback
func (p *Processor) ProcessEvents(fileName string, objects []map[string]interface{}, alreadyUploadedTables map[string]bool) (map[string]*ProcessedFile, *events.FailedEvents, error) {
	return p.process(fileName, objects, alreadyUploadedTables, false)
}

//ProcessPulledEvents processes events objects
//returns array of processed objects per table like {"table1": []objects, "table2": []objects},
//or error if at least 1 was occurred
func (p *Processor) ProcessPulledEvents(fileName string, objects []map[string]interface{}) (map[string]*ProcessedFile, error) {
	flatData, _, err := p.process(fileName, objects, map[string]bool{}, true)
	return flatData, err
}

//ProcessEvents process events objects
//returns array of processed objects per table like {"table1": []objects, "table2": []objects},
//All failed events are moved to separate collection for sending to fallback
func (p *Processor) process(fileName string, objects []map[string]interface{}, alreadyUploadedTables map[string]bool, breakOnErr bool) (map[string]*ProcessedFile, *events.FailedEvents, error) {
	failedEvents := events.NewFailedEvents()
	filePerTable := map[string]*ProcessedFile{}

	for _, event := range objects {
		batchHeader, processedObject, err := p.processObject(event, alreadyUploadedTables)
		if err != nil {
			//handle skip object functionality
			if err == ErrSkipObject {
				if !appconfig.Instance.DisableSkipEventsWarn {
					logging.Warnf("[%s] Event [%s]: %v", p.identifier, events.ExtractEventID(event), err)
				}

				counters.SkipEvents(p.identifier, 1)
			} else if p.breakOnError || breakOnErr {
				return nil, nil, err
			} else {
				eventBytes, _ := json.Marshal(event)

				logging.Warnf("Unable to process object %s: %v. This line will be stored in fallback.", string(eventBytes), err)

				failedEvents.Events = append(failedEvents.Events, &events.FailedEvent{
					Event:   eventBytes,
					Error:   err.Error(),
					EventID: events.ExtractEventID(event),
				})
				failedEvents.Src[events.ExtractSrc(event)]++
			}
		}

		//don't process empty and skipped object (batchHeader.Exists() func is nil-protected)
		if batchHeader.Exists() {
			f, ok := filePerTable[batchHeader.TableName]
			if !ok {
				filePerTable[batchHeader.TableName] = &ProcessedFile{
					FileName:    fileName,
					BatchHeader: batchHeader,
					payload:     []map[string]interface{}{processedObject},
					eventsSrc:   map[string]int{events.ExtractSrc(event): 1},
				}
			} else {
				f.BatchHeader.Fields.Merge(batchHeader.Fields)
				f.payload = append(f.payload, processedObject)
				f.eventsSrc[events.ExtractSrc(event)]++
			}
		}
	}

	return filePerTable, failedEvents, nil
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
