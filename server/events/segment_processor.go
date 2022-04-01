package events

import "github.com/jitsucom/jitsu/server/logging"

//SegmentProcessor preprocess client integration events
type SegmentProcessor struct {
	usersRecognition Recognition
}

//NewSegmentProcessor returns configured SegmentProcessor
func NewSegmentProcessor(usersRecognition Recognition) *SegmentProcessor {
	return &SegmentProcessor{usersRecognition: usersRecognition}
}

//Preprocess adds src value
//sets user anonymous ID if GDPR
func (sp *SegmentProcessor) Preprocess(event Event, reqContext *RequestContext) {
	event[SrcKey] = "segment_api"

	if !reqContext.CookiesLawCompliant {
		if err := UserAnonymIDPath.Set(event, reqContext.JitsuAnonymousID); err != nil {
			logging.SystemErrorf("Error setting generated Jitsu anonymous ID: %v", err)
		}
	}
	HashedAnonymIDPath.Set(event, reqContext.HashedAnonymousID)
}

//Postprocess puts event into recognition Service
func (sp *SegmentProcessor) Postprocess(event Event, eventID string, destinationIDs []string, tokenID string) {
	sp.usersRecognition.Event(event, eventID, destinationIDs, tokenID)
}

//Type returns preprocessor type
func (sp *SegmentProcessor) Type() string {
	return segmentPreprocessorType
}
