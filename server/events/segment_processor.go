package events

import (
	"net/http"
)

//SegmentProcessor preprocess client integration events
type SegmentProcessor struct {
	usersRecognition Recognition
}

//NewSegmentProcessor returns configured SegmentProcessor
func NewSegmentProcessor(usersRecognition Recognition) Processor {
	return &SegmentProcessor{usersRecognition: usersRecognition}
}

//Preprocess adds src value
func (sp *SegmentProcessor) Preprocess(event Event, r *http.Request) {
	event[SrcKey] = "segment_api"
}

//Postprocess puts event into recognition Service
func (sp *SegmentProcessor) Postprocess(event Event, eventID string, destinationIDs []string) {
	sp.usersRecognition.Event(event, eventID, destinationIDs)
}

//Type returns preprocessor type
func (sp *SegmentProcessor) Type() string {
	return SegmentPreprocessorType
}
