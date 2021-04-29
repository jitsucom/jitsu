package events

import (
	"net/http"
)

//APIProcessor preprocess server 2 server integration events
type APIProcessor struct {
}

//NewAPIProcessor returns new API preprocessor
func NewAPIProcessor() Processor {
	return &APIProcessor{}
}

//Preprocess puts src = api
func (ap *APIProcessor) Preprocess(event Event, r *http.Request) {
	event[SrcKey] = "api"
}

//Postprocess does nothing
func (ap *APIProcessor) Postprocess(event Event, eventID string, destinationIDs []string) {
}

//Type returns preprocessor type
func (ap *APIProcessor) Type() string {
	return APIPreprocessorType
}
