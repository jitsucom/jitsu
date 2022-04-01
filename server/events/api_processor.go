package events

//APIProcessor preprocess server 2 server integration events
type APIProcessor struct {
	usersRecognition Recognition
}

//NewAPIProcessor returns new API preprocessor
func NewAPIProcessor(usersRecognition Recognition) *APIProcessor {
	return &APIProcessor{usersRecognition: usersRecognition}
}

//Preprocess puts src = api if doesn't exist
func (ap *APIProcessor) Preprocess(event Event, requestContext *RequestContext) {
	if _, ok := event[SrcKey]; !ok {
		event[SrcKey] = "api"
	}
}

//Postprocess does nothing
func (ap *APIProcessor) Postprocess(event Event, eventID string, destinationIDs []string, tokenID string) {
	ap.usersRecognition.Event(event, eventID, destinationIDs, tokenID)
}

//Type returns preprocessor type
func (ap *APIProcessor) Type() string {
	return apiPreprocessorType
}
