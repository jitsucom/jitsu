package events

//SegmentProcessor preprocess client integration events
type SegmentProcessor struct {
	usersRecognition Recognition
}

//NewSegmentProcessor returns configured SegmentProcessor
func NewSegmentProcessor(usersRecognition Recognition) *SegmentProcessor {
	return &SegmentProcessor{usersRecognition: usersRecognition}
}

//Preprocess adds src value
func (sp *SegmentProcessor) Preprocess(event Event, reqContext *RequestContext) {
	event[SrcKey] = "segment_api"
}

//Postprocess puts event into recognition Service
func (sp *SegmentProcessor) Postprocess(event Event, eventID string, destinationIDs []string) {
	sp.usersRecognition.Event(event, eventID, destinationIDs)
}

//Type returns preprocessor type
func (sp *SegmentProcessor) Type() string {
	return segmentPreprocessorType
}
