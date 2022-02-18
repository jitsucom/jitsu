package events

const (
	apiPreprocessorType     = "api"
	jsPreprocessorType      = "js"
	pixelPreprocessorType   = "pixel"
	segmentPreprocessorType = "segment"
	bulkPreprocessorType    = "bulk"
)

//RequestContext is a dto for keeping request data like special headers or e.g. client IP address
type RequestContext struct {
	UserAgent           string `json:"user_agent,omitempty"`
	ClientIP            string `json:"client_ip,omitempty"`
	Referer             string `json:"referer,omitempty"`
	JitsuAnonymousID    string `json:"jitsu_anonymous_id,omitempty"`
	HashedAnonymousID   string `json:"hashed_anonymous_id,omitempty"`
	CookiesLawCompliant bool   `json:"cookie_laws_compliant,omitempty"`
}

// Processor is used in preprocessing and postprocessing events before and after consuming(storing)
// should be stateless
type Processor interface {
	Preprocess(event Event, requestContext *RequestContext)
	Postprocess(event Event, eventID string, destinationIDs []string, tokenID string)
	Type() string
}

//ProcessorHolder is used for holding Processor instances per type
type ProcessorHolder struct {
	processors map[string]Processor
}

//NewProcessorHolder returns configured ProcessHolder with all processor types instances
func NewProcessorHolder(apiProcessor *APIProcessor, jsProcessor *JsProcessor, pixelProcessor *PixelProcessor,
	segmentProcessor *SegmentProcessor, bulkProcessor *BulkProcessor) *ProcessorHolder {
	return &ProcessorHolder{map[string]Processor{
		apiPreprocessorType:     apiProcessor,
		jsPreprocessorType:      jsProcessor,
		pixelPreprocessorType:   pixelProcessor,
		segmentPreprocessorType: segmentProcessor,
		bulkPreprocessorType:    bulkProcessor,
	}}
}

func (ph *ProcessorHolder) GetAPIPreprocessor() Processor {
	return ph.GetByType(apiPreprocessorType)
}

func (ph *ProcessorHolder) GetJSPreprocessor() Processor {
	return ph.GetByType(jsPreprocessorType)
}

func (ph *ProcessorHolder) GetPixelPreprocessor() Processor {
	return ph.GetByType(pixelPreprocessorType)
}

func (ph *ProcessorHolder) GetSegmentPreprocessor() Processor {
	return ph.GetByType(segmentPreprocessorType)
}

func (ph *ProcessorHolder) GetBulkPreprocessor() Processor {
	return ph.GetByType(bulkPreprocessorType)
}

func (ph *ProcessorHolder) GetByType(processorType string) Processor {
	return ph.processors[processorType]
}
