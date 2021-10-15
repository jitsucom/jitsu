package schema

import (
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/enrichment"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/identifiers"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/maputils"
	"github.com/jitsucom/jitsu/server/templates"
	"strings"
)
const TableNameParameter = "__JITSU_TABLE_NAME"

var ErrSkipObject = errors.New("Table name template return empty string. This object will be skipped.")

type Envelope struct {
	Header *BatchHeader
	Event events.Event
}

type Processor struct {
	identifier              string
	tableNameExtractor      *TableNameExtractor
	lookupEnrichmentStep    *enrichment.LookupEnrichmentStep
	transformer				*templates.JsTemplateExecutor
	mappingStep             *MappingStep
	pulledEventsMappingStep *MappingStep
	breakOnError            bool
	uniqueIDField           *identifiers.UniqueID
	maxColumnNameLen        int
}

func NewProcessor(destinationID, tableNameFuncExpression string, transform string, fieldMapper events.Mapper, enrichmentRules []enrichment.Rule,
	flattener Flattener, typeResolver TypeResolver, breakOnError bool, uniqueIDField *identifiers.UniqueID, maxColumnNameLen int) (*Processor, error) {
	mappingStep := NewMappingStep(fieldMapper, flattener, typeResolver)
	pulledEventsMappingStep := NewMappingStep(&DummyMapper{}, flattener, typeResolver)
	tableNameExtractor, err := NewTableNameExtractor(tableNameFuncExpression)
	if err != nil {
		return nil, err
	}
	var transformer	*templates.JsTemplateExecutor
	if transform != "" && transform != templates.TransformDefaultTemplate {
		transformFunctions := make(map[string]interface{})
		for k,v := range templates.JSONSerializeFuncs {
			transformFunctions[k] = v
		}
		transformFunctions["TABLE_NAME"] = TableNameParameter
		transformer, err = templates.NewJsTemplateExecutor(transform, transformFunctions)
		if err != nil {
			return nil, fmt.Errorf("failed to init transform javascript: %v", err)
		}
	}
	return &Processor{
		identifier:              destinationID,
		tableNameExtractor:      tableNameExtractor,
		lookupEnrichmentStep:    enrichment.NewLookupEnrichmentStep(enrichmentRules),
		transformer: 			 transformer,
		mappingStep:             mappingStep,
		pulledEventsMappingStep: pulledEventsMappingStep,
		breakOnError:            breakOnError,
		uniqueIDField:           uniqueIDField,
		maxColumnNameLen:        maxColumnNameLen,
	}, nil
}

//ProcessEvent returns table representation, processed flatten object
func (p *Processor) ProcessEvent(event map[string]interface{}) ([]Envelope, error) {
	return p.processObject(event, map[string]bool{})
}

//ProcessEvents processes events objects
//returns array of processed objects per table like {"table1": []objects, "table2": []objects},
//All failed events are moved to separate collection for sending to fallback
func (p *Processor) ProcessEvents(fileName string, objects []map[string]interface{}, alreadyUploadedTables map[string]bool) (map[string]*ProcessedFile, *events.FailedEvents, *events.SkippedEvents, error) {
	skippedEvents := &events.SkippedEvents{}
	failedEvents := events.NewFailedEvents()
	filePerTable := map[string]*ProcessedFile{}

	for _, event := range objects {
		envelops, err := p.processObject(event, alreadyUploadedTables)
		if err != nil {
			//handle skip object functionality
			if err == ErrSkipObject {
				eventID := p.uniqueIDField.Extract(event)
				if !appconfig.Instance.DisableSkipEventsWarn {
					logging.Warnf("[%s] Event [%s]: %v", p.identifier, eventID, err)
				}

				skippedEvents.Events = append(skippedEvents.Events, &events.SkippedEvent{EventID: eventID, Error: ErrSkipObject.Error()})
			} else if p.breakOnError {
				return nil, nil, nil, err
			} else {
				eventBytes, _ := json.Marshal(event)

				logging.Warnf("Unable to process object %s: %v. This line will be stored in fallback.", string(eventBytes), err)

				failedEvents.Events = append(failedEvents.Events, &events.FailedEvent{
					Event:   eventBytes,
					Error:   err.Error(),
					EventID: p.uniqueIDField.Extract(event),
				})
				failedEvents.Src[events.ExtractSrc(event)]++
			}
		}
		for _, envelop := range envelops {
			//don't process empty and skipped object (batchHeader.Exists() func is nil-protected)
			batchHeader := envelop.Header
			processedObject := envelop.Event
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
	}

	return filePerTable, failedEvents, skippedEvents, nil
}

//ProcessPulledEvents processes events objects without applying mapping rules
//returns array of processed objects under tablename
//or error if at least 1 was occurred
func (p *Processor) ProcessPulledEvents(tableName string, objects []map[string]interface{}) (map[string]*ProcessedFile, error) {
	var pf *ProcessedFile
	for _, event := range objects {
		batchHeader, processedObject, err := p.pulledEventsMappingStep.Execute(tableName, event)
		if err != nil {
			return nil, err
		}

		//don't process empty and skipped object
		if !batchHeader.Exists() {
			continue
		}

		foldedBatchHeader, foldedObject, _ := p.foldLongFields(batchHeader, processedObject)

		if pf == nil {
			pf = &ProcessedFile{
				FileName:    tableName,
				BatchHeader: foldedBatchHeader,
				payload:     []map[string]interface{}{foldedObject},
				eventsSrc:   map[string]int{events.ExtractSrc(event): 1},
			}
		} else {
			pf.BatchHeader.Fields.Merge(foldedBatchHeader.Fields)
			pf.payload = append(pf.payload, foldedObject)
			pf.eventsSrc[events.ExtractSrc(event)]++
		}
	}

	return map[string]*ProcessedFile{tableName: pf}, nil
}

//processObject checks if table name in skipTables => return empty Table for skipping or
//skips object if tableNameExtractor returns empty string, 'null' or 'false'
//returns table representation of object and flatten, mapped object
//1. extract table name
//2. execute enrichment.LookupEnrichmentStep and MappingStep
//or ErrSkipObject/another error
func (p *Processor) processObject(object map[string]interface{}, alreadyUploadedTables map[string]bool) ([]Envelope, error) {
	objectCopy := maputils.CopyMap(object)
	tableName, err := p.tableNameExtractor.Extract(objectCopy)
	if err != nil {
		return nil, err
	}
	if tableName == "" || tableName == "null" || tableName == "false" {
		return nil, ErrSkipObject
	}
	p.lookupEnrichmentStep.Execute(objectCopy)
	bh, mappedObject, err := p.mappingStep.Execute(tableName, objectCopy)
	if err != nil {
		return nil, err
	}
	var transformed interface{}
	if p.transformer != nil {
		transformed, err = p.transformer.ProcessEvent(mappedObject)
		if err != nil {
			return nil, fmt.Errorf("failed to apply javascript transform: %v", err)
		}
	} else {
		transformed = mappedObject
	}
	if transformed == nil {
		//transform that returns null causes skipped event
		return nil, ErrSkipObject
	}
	toProcess := make([]map[string]interface{}, 0, 1)
	switch obj := transformed.(type) {
	case map[string]interface{}:
		toProcess = append(toProcess, obj)
	case []map[string]interface{}:
		for i, o := range obj {
			newUniqueId := fmt.Sprintf("%s_%d", appconfig.Instance.GlobalUniqueIDField.Extract(o), i)
			appconfig.Instance.GlobalUniqueIDField.Set(o, newUniqueId)
			toProcess = append(toProcess, o)
		}
	default:
		return nil, fmt.Errorf("javascript transform result of incorrect type: %T Expected object.", transformed)
	}
	envelops := make([]Envelope, 0, len(toProcess))

	for _, object := range toProcess {
		tableName := fmt.Sprint(object[TableNameParameter])
		if tableName == "" {
			tableName = bh.TableName
		}
		//object has been already processed (storage:table pair might be already processed)
		_, ok := alreadyUploadedTables[tableName]
		if ok {
			continue
		}
		bh, obj, err := p.foldLongFields(&BatchHeader{tableName, bh.Fields}, object)
		if err != nil {
			return nil, fmt.Errorf("failed to process long fields: %v", err)
		}
		envelops = append(envelops, Envelope{bh, obj} )
	}

	return envelops, nil
}

//foldLongFields replace all column names with truncated values if they exceed the limit
//uses cutName under the hood
func (p *Processor) foldLongFields(header *BatchHeader, object map[string]interface{}) (*BatchHeader, map[string]interface{}, error) {
	if p.maxColumnNameLen <= 0 {
		return header, object, nil
	}

	changes := map[string]string{}
	for name := range header.Fields {
		if len(name) > p.maxColumnNameLen {
			newName := cutName(name, p.maxColumnNameLen)
			if name != newName {
				changes[name] = newName
			}
		}
	}

	for oldName, newName := range changes {
		field, _ := header.Fields[oldName]
		delete(header.Fields, oldName)
		header.Fields[newName] = field

		if value, ok := object[oldName]; ok {
			delete(object, oldName)
			object[newName] = value
		}
	}

	return header, object, nil
}

func (p *Processor) Close() {
	p.tableNameExtractor.Close()
	if p.transformer != nil {
		p.transformer.Close()
	}
}

//cutName converts input name that exceeds maxLen to lower length string by cutting parts between '_' to 2 symbols.
//if name len is still greater then returns maxLen symbols from the end of the name
func cutName(name string, maxLen int) string {
	if len(name) <= maxLen {
		return name
	}

	//just cut from the beginning
	if !strings.Contains(name, "_") {
		return name[len(name)-maxLen:]
	}

	var replaced bool
	replace := ""
	for _, part := range strings.Split(name, "_") {
		if replace != "" {
			replace += "_"
		}

		if len(part) > 2 {
			newPart := part[:2]
			name = strings.ReplaceAll(name, replace+part, replace+newPart)
			replaced = true
			break
		} else {
			replace += part
		}
	}

	if !replaced {
		//case when ab_ac_ad and maxLen = 6
		return name[len(name)-maxLen:]
	}

	return cutName(name, maxLen)
}
