package schema

import (
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/server/metrics"
	"strings"

	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/config"
	"github.com/jitsucom/jitsu/server/enrichment"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/identifiers"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/maputils"
	"github.com/jitsucom/jitsu/server/templates"
	"github.com/jitsucom/jitsu/server/timestamp"
	"github.com/jitsucom/jitsu/server/uuid"
)

var ErrSkipObject = errors.New("Transform or table name filter marked object to be skipped. This object will be skipped.")

const (
	JitsuEnvelopParameter    = "JITSU_ENVELOP"
	JitsuUserRecognizedEvent = "JITSU_UR_EVENT"
)

var (
	EventSpecialParameters = []string{
		templates.TableNameParameter,
		JitsuEnvelopParameter,
		JitsuUserRecognizedEvent,
	}
)

//go:embed segment.js
var segmentTransform string

type Envelope struct {
	Header        *BatchHeader
	Event         events.Event
	OriginalEvent string
}

type Processor struct {
	identifier              string
	destinationConfig       *config.DestinationConfig
	isSQLType               bool
	tableNameExtractor      *TableNameExtractor
	lookupEnrichmentStep    *enrichment.LookupEnrichmentStep
	transformer             templates.TemplateExecutor
	builtinTransformer      templates.TemplateExecutor
	fieldMapper             events.Mapper
	pulledEventsfieldMapper events.Mapper
	typeResolver            TypeResolver
	flattener               Flattener
	breakOnError            bool
	uniqueIDField           *identifiers.UniqueID
	maxColumnNameLen        int
	tableNameFuncExpression string
	defaultUserTransform    string
	javaScripts             []string
	jsVariables             map[string]interface{}
	//indicate that we didn't forget to init JavaScript transform
	transformInitialized   bool
	MappingStyle           string
	userRecognitionEnabled bool
}

func NewProcessor(destinationID string, destinationConfig *config.DestinationConfig, isSQLType bool, tableNameFuncExpression string, fieldMapper events.Mapper, enrichmentRules []enrichment.Rule, flattener Flattener, typeResolver TypeResolver, uniqueIDField *identifiers.UniqueID, maxColumnNameLen int, mappingStyle string, userRecognitionEnabled bool) (*Processor, error) {
	return &Processor{
		identifier:              destinationID,
		destinationConfig:       destinationConfig,
		isSQLType:               isSQLType,
		lookupEnrichmentStep:    enrichment.NewLookupEnrichmentStep(enrichmentRules),
		fieldMapper:             fieldMapper,
		pulledEventsfieldMapper: &DummyMapper{},
		typeResolver:            typeResolver,
		flattener:               flattener,
		breakOnError:            destinationConfig.BreakOnError,
		uniqueIDField:           uniqueIDField,
		maxColumnNameLen:        maxColumnNameLen,
		tableNameFuncExpression: tableNameFuncExpression,
		javaScripts:             []string{},
		jsVariables:             map[string]interface{}{},
		MappingStyle:            mappingStyle,
		userRecognitionEnabled:  userRecognitionEnabled,
	}, nil
}

// ProcessEvent returns table representation, processed flatten object
func (p *Processor) ProcessEvent(event map[string]interface{}, needCopyEvent bool) ([]Envelope, error) {
	if !p.transformInitialized {
		err := fmt.Errorf("Destination: %s Attempt to use processor without running InitJavaScriptTemplates first", p.identifier)
		return nil, err
	}
	return p.processObject(event, map[string]bool{}, needCopyEvent)
}

// ProcessEvents processes events objects
// returns array of processed objects per table like {"table1": []objects, "table2": []objects},
// All failed events are moved to separate collection for sending to fallback
func (p *Processor) ProcessEvents(fileName string, objects []map[string]interface{}, alreadyUploadedTables map[string]bool, needCopyEvent bool) (flatData map[string]*ProcessedFile, recognizedFlatData map[string]*ProcessedFile, failedEvents *events.FailedEvents, skippedEvents *events.SkippedEvents, err error) {
	if !p.transformInitialized {
		err := fmt.Errorf("Destination: %s Attempt to use processor without running InitJavaScriptTemplates first", p.identifier)
		return nil, nil, nil, nil, err
	}
	skippedEvents = &events.SkippedEvents{}
	failedEvents = events.NewFailedEvents()
	flatData = map[string]*ProcessedFile{}
	recognizedFlatData = map[string]*ProcessedFile{}

	for _, event := range objects {
		_, recognizedEvent := event[JitsuUserRecognizedEvent]
		if recognizedEvent && !p.userRecognitionEnabled {
			//skip recognized event for storages with disabled/not supported UR
			continue
		}
		envelops, err := p.processObject(event, alreadyUploadedTables, needCopyEvent)
		if err != nil {
			//handle skip object functionality
			if err == ErrSkipObject {
				eventID := p.uniqueIDField.Extract(event)
				if !appconfig.Instance.DisableSkipEventsWarn {
					logging.Warnf("[%s] Event [%s]: %v", p.identifier, eventID, err)
				}

				originalEventBytes, _ := json.Marshal(event)
				skippedEvents.Events = append(skippedEvents.Events, &events.SkippedEvent{Event: originalEventBytes, Error: ErrSkipObject.Error(), RecognizedEvent: recognizedEvent})
			} else if p.breakOnError {
				return nil, nil, nil, nil, err
			} else {
				originalEventBytes, _ := json.Marshal(event)

				logging.Warnf("Unable to process object %s: %v. This line will be stored in fallback.", string(originalEventBytes), err)

				failedEvents.Events = append(failedEvents.Events, &events.FailedEvent{
					Event:           originalEventBytes,
					Error:           err.Error(),
					EventID:         p.uniqueIDField.Extract(event),
					RecognizedEvent: recognizedEvent,
				})
				failedEvents.Src[events.ExtractSrc(event)]++
			}
		}
		for _, envelop := range envelops {
			//don't process empty and skipped object (batchHeader.Exists() func is nil-protected)
			batchHeader := envelop.Header
			processedObject := envelop.Event
			rawOriginalEvent := envelop.OriginalEvent
			if batchHeader.Exists() {
				var fData map[string]*ProcessedFile
				if recognizedEvent {
					fData = recognizedFlatData
				} else {
					fData = flatData
				}

				f, ok := fData[batchHeader.TableName]
				if !ok {
					fData[batchHeader.TableName] = &ProcessedFile{
						FileName:           fileName,
						BatchHeader:        batchHeader,
						RecognitionPayload: recognizedEvent,
						payload:            []map[string]interface{}{processedObject},
						originalRawEvents:  []string{rawOriginalEvent},
						eventsSrc:          map[string]int{events.ExtractSrc(event): 1},
					}
				} else {
					f.BatchHeader.Fields.Merge(batchHeader.Fields)
					f.payload = append(f.payload, processedObject)
					f.originalRawEvents = append(f.originalRawEvents, rawOriginalEvent)
					f.eventsSrc[events.ExtractSrc(event)]++
				}
			}
		}
	}

	return flatData, recognizedFlatData, failedEvents, skippedEvents, nil
}

// ProcessPulledEvents processes events objects without applying mapping rules
// returns array of processed objects under tablename
// or error if at least 1 was occurred
func (p *Processor) ProcessPulledEvents(tableName string, objects []map[string]interface{}) (map[string]*ProcessedFile, error) {
	if !p.transformInitialized {
		err := fmt.Errorf("Destination: %s Attempt to use processor without running InitJavaScriptTemplates first", p.identifier)
		return nil, err
	}
	var pf *ProcessedFile
	for _, event := range objects {
		processedObject, err := p.pulledEventsfieldMapper.Map(event)
		if err != nil {
			return nil, fmt.Errorf("Error mapping object: %v", err)
		}
		flatObject, err := p.flattener.FlattenObject(processedObject)
		if err != nil {
			return nil, err
		}
		fields, err := p.typeResolver.Resolve(flatObject)
		if err != nil {
			return nil, err
		}
		batchHeader := &BatchHeader{TableName: tableName, Fields: fields}

		//don't process empty and skipped object
		if !batchHeader.Exists() {
			continue
		}

		foldedBatchHeader, foldedObject, _ := p.foldLongFields(batchHeader, flatObject)

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

// processObject checks if table name in skipTables => return empty Table for skipping or
// skips object if tableNameExtractor returns empty string, 'null' or 'false'
// returns table representation of object and flatten, mapped object
// 1. extract table name
// 2. execute enrichment.LookupEnrichmentStep and Mapping
// or ErrSkipObject/another error
func (p *Processor) processObject(object map[string]interface{}, alreadyUploadedTables map[string]bool, needCopyEvent bool) ([]Envelope, error) {
	var workingObject map[string]interface{}
	if needCopyEvent {
		//we need to copy event when more that one storage can process the same event in parallel
		workingObject = maputils.CopyMap(object)
	} else {
		workingObject = object
	}

	p.lookupEnrichmentStep.Execute(workingObject)
	mappedObject, err := p.fieldMapper.Map(workingObject)
	if err != nil {
		return nil, fmt.Errorf("Error mapping object: %v", err)
	}

	if err != nil {
		return nil, err
	}
	var transformed interface{}
	if p.transformer != nil {
		transformed, err = p.transformer.ProcessEvent(mappedObject, nil)
		if err != nil {
			metrics.TransformErrors(p.identifier)
			return nil, fmt.Errorf("failed to apply javascript transform: %v", err)
		}
	} else {
		transformed = mappedObject
	}
	if transformed == nil {
		//transform that returns null causes skipped event
		return nil, ErrSkipObject
	}
	if p.builtinTransformer != nil {
		transformedObj, ok := transformed.(map[string]interface{})
		if !ok {
			return nil, fmt.Errorf("builtin javascript transform requires object. Got: %T", transformed)
		}
		transformed, err = p.builtinTransformer.ProcessEvent(transformedObj, nil)
		if err != nil {
			return nil, fmt.Errorf("failed to apply builtin javascript transform: %v", err)
		}
	}
	if transformed == nil {
		//transform that returns null causes skipped event
		return nil, ErrSkipObject
	}
	toProcess := make([]map[string]interface{}, 0, 1)
	switch obj := transformed.(type) {
	case map[string]interface{}:
		toProcess = append(toProcess, obj)
	case []interface{}:
		for _, o := range obj {
			switch value := o.(type) {
			case map[string]interface{}:
				toProcess = append(toProcess, value)
			case bool:
				if value {
					//#872 react-style pattern: we ignore 'false' but it is not clear how to interpret 'true' value
					return nil, fmt.Errorf("javascript transform result of incorrect type: %T Expected map[string]interface{}.", o)
				}
			case nil:
				//#872 react-style pattern: undefined-s and null-s get ignored
			default:
				return nil, fmt.Errorf("javascript transform result of incorrect type: %T Expected map[string]interface{}.", o)
			}
		}
	default:
		return nil, fmt.Errorf("javascript transform result of incorrect type: %T Expected map[string]interface{}.", transformed)
	}
	if len(toProcess) == 0 {
		//transform that returns no events causes skipped event
		return nil, ErrSkipObject
	}
	envelops := make([]Envelope, 0, len(toProcess))
	originalEvent, _ := json.Marshal(object)
	for i, prObject := range toProcess {
		newUniqueId := p.uniqueIDField.Extract(object)
		if newUniqueId == "" {
			newUniqueId = uuid.New()
		}
		delete(prObject, JitsuUserRecognizedEvent)
		if i > 0 {
			//for event cache one to many mapping
			newUniqueId = fmt.Sprintf("%s_%d", newUniqueId, i)
			prObject[p.uniqueIDField.GetFlatFieldName()] = newUniqueId
		}
		if p.isSQLType {
			prObject[p.uniqueIDField.GetFlatFieldName()] = newUniqueId
			prObject[timestamp.Key] = workingObject[timestamp.Key]
			if _, ok := object[timestamp.Key]; !ok {
				prObject[timestamp.Key] = timestamp.NowUTC()
			}
		}
		tableName, tableNameFromTransform := prObject[templates.TableNameParameter].(string)
		if !tableNameFromTransform {
			tableName, err = p.tableNameExtractor.Extract(prObject)
			if err != nil {
				return nil, err
			}
		}
		if tableName == "" || tableName == "null" || tableName == "false" {
			return nil, ErrSkipObject
		}
		delete(prObject, templates.TableNameParameter)
		delete(prObject, events.HTTPContextField)
		//object has been already processed (storage:table pair might be already processed)
		_, ok := alreadyUploadedTables[tableName]
		if ok {
			continue
		}
		flatObject, err := p.flattener.FlattenObject(prObject)
		if err != nil {
			return nil, err
		}
		fields, err := p.typeResolver.Resolve(flatObject)
		if err != nil {
			return nil, err
		}
		ClearTypeMetaFields(flatObject)
		bh, obj, err := p.foldLongFields(&BatchHeader{TableName: tableName, Fields: fields}, flatObject)
		if err != nil {
			return nil, fmt.Errorf("failed to process long fields: %v", err)
		}
		envelops = append(envelops, Envelope{Header: bh, Event: obj, OriginalEvent: string(originalEvent)})
	}

	return envelops, nil
}

// foldLongFields replace all column names with truncated values if they exceed the limit
// uses cutName under the hood
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

// AddJavaScript loads javascript to transformation template's vm
func (p *Processor) AddJavaScript(js string) {
	p.javaScripts = append(p.javaScripts, js)
}

// AddJavaScriptVariables loads variable to globalThis object of transformation template's vm
func (p *Processor) AddJavaScriptVariables(jsVar map[string]interface{}) {
	for k, v := range jsVar {
		p.jsVariables[k] = v
	}
}

// SetDefaultUserTransform set default transformation code that will be used if no transform or mapping settings provided
func (p *Processor) SetDefaultUserTransform(defaultUserTransform string) {
	p.defaultUserTransform = defaultUserTransform
}

// SetBuiltinTransformer javascript executor for builtin js code (e.g. npm destination)
func (p *Processor) SetBuiltinTransformer(builtinTransformer templates.TemplateExecutor) {
	p.builtinTransformer = builtinTransformer
}

// InitJavaScriptTemplates loads destination transform javascript, inits context variables.
// and sets up template executor
func (p *Processor) InitJavaScriptTemplates() (err error) {
	if p.transformInitialized {
		return nil
	}
	defer func() {
		if err == nil {
			p.transformInitialized = true
		} else {
			p.CloseJavaScriptTemplates()
		}
	}()
	templateVariables := make(map[string]interface{})
	templateVariables["destinationId"] = p.identifier
	templateVariables["destinationType"] = p.destinationConfig.Type
	templateVariables = templates.EnrichedFuncMap(templateVariables)
	tableNameExtractor, err := NewTableNameExtractor(p.tableNameFuncExpression, templateVariables)
	if err != nil {
		return
	}
	p.tableNameExtractor = tableNameExtractor
	p.AddJavaScriptVariables(templateVariables)

	transformDisabled := false
	var userTransform string
	mappingDisabled := false
	switch p.fieldMapper.(type) {
	case DummyMapper, *DummyMapper, nil:
		mappingDisabled = true
	}
	if dataLayout := p.destinationConfig.DataLayout; dataLayout != nil {
		transformDisabled = dataLayout.TransformEnabled != nil && !*dataLayout.TransformEnabled
		userTransform = dataLayout.Transform
	}
	if transformDisabled {
		//transform is explicitly disabled
		return nil
	}
	if userTransform == templates.TransformDefaultTemplate {
		userTransform = ""
	}
	if userTransform != "" && !mappingDisabled {
		return fmt.Errorf("mapping and javascript transform cannot be enabled at the same time")
	}
	//some destinations have built-in javascript transformation that must be used
	//even if no explicit transform settings were provided. Only exception is enabled mapping –
	//if mapping is set for destination - javascript transformation cannot be used
	if userTransform == "" && p.defaultUserTransform != "" {
		if !mappingDisabled {
			logging.Warnf(`%s %s destination supports data mapping via builtin javascript transformation but mapping feature is enabled via config.
Mapping feature is deprecated. It is recommended to migrate to javascript data transformation.`, p.identifier, p.destinationConfig.Type)
			return nil
		} else {
			userTransform = p.defaultUserTransform
		}
	}
	if userTransform != "" {
		if strings.Contains(userTransform, "toSegment") {
			//seems like built-in to segment transformation is used. We need to load script
			p.AddJavaScript(segmentTransform)
		}
		transformer, err := templates.NewScriptExecutor(templates.Expression(userTransform), p.jsVariables, p.javaScripts...)
		if err != nil {
			return fmt.Errorf("failed to init transform javascript: %v", err)
		}
		p.transformer = transformer
	}
	return nil
}

func (p *Processor) CloseJavaScriptTemplates() {
	if p.tableNameExtractor != nil {
		p.tableNameExtractor.Close()
	}
	if p.transformer != nil {
		p.transformer.Close()
	}
	if p.builtinTransformer != nil {
		p.builtinTransformer.Close()
	}
}

func (p *Processor) GetTransformer() templates.TemplateExecutor {
	return p.transformer
}

func (p *Processor) DestinationType() string {
	return p.destinationConfig.Type
}

func (p *Processor) Close() {
	p.CloseJavaScriptTemplates()
}

// cutName converts input name that exceeds maxLen to lower length string by cutting parts between '_' to 2 symbols.
// if name len is still greater then returns maxLen symbols from the end of the name
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

func ClearTypeMetaFields(object map[string]interface{}) {
	for k, v := range object {
		if strings.Contains(k, SqlTypeKeyword) {
			delete(object, k)
		} else {
			obj, ok := v.(map[string]interface{})
			if ok {
				ClearTypeMetaFields(obj)
			}
		}
	}
}
