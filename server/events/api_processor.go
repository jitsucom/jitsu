package events

//APIProcessor preprocess server 2 server integration events
type APIProcessor struct {
}

//NewAPIProcessor returns new API preprocessor
func NewAPIProcessor() *APIProcessor {
	return &APIProcessor{}
}

//Preprocess puts src = api
func (ap *APIProcessor) Preprocess(event Event, requestContext *RequestContext) {
	event[SrcKey] = "api"
}

//Postprocess does nothing
func (ap *APIProcessor) Postprocess(event Event, eventID string, destinationIDs []string) {
}

//Type returns preprocessor type
func (ap *APIProcessor) Type() string {
	return apiPreprocessorType
}
