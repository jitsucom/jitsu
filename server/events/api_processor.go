package events

//APIProcessor preprocess server 2 server integration events
type APIProcessor struct {
}

//NewAPIProcessor returns new API preprocessor
func NewAPIProcessor() *APIProcessor {
	return &APIProcessor{}
}

//Preprocess puts src = api if doesn't exist
func (ap *APIProcessor) Preprocess(event Event, requestContext *RequestContext) {
	if _, ok := event[SrcKey]; !ok {
		event[SrcKey] = "api"
	}
}

//Postprocess does nothing
func (ap *APIProcessor) Postprocess(event Event, eventID string, destinationIDs []string, tokenID string) {
}

//Type returns preprocessor type
func (ap *APIProcessor) Type() string {
	return apiPreprocessorType
}
