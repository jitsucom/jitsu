package events

import (
	"github.com/jitsucom/jitsu/server/jsonutils"
	"github.com/jitsucom/jitsu/server/logging"
	"net/http"
)

const (
	JSPreprocessorType      = "js"
	APIPreprocessorType     = "api"
	SegmentPreprocessorType = "segment"
)

//Processor is used in preprocessing and postprocessing events before consuming(storing)
type Processor interface {
	Preprocess(event Event, r *http.Request)
	Postprocess(event Event, eventID string, destinationIDs []string)
	Type() string
}

//JsProcessor preprocess client integration events
type JsProcessor struct {
	usersRecognition  Recognition
	userAgentJSONPath jsonutils.JSONPath
}

//NewJsProcessor returns configured JsProcessor
func NewJsProcessor(usersRecognition Recognition, userAgentPath string) Processor {
	return &JsProcessor{usersRecognition: usersRecognition, userAgentJSONPath: jsonutils.NewJSONPath(userAgentPath)}
}

//Preprocess set user-agent from request header to configured nodes
func (jp *JsProcessor) Preprocess(event Event, r *http.Request) {
	clientUserAgent := r.Header.Get("user-agent")
	if clientUserAgent != "" {
		if err := jp.userAgentJSONPath.Set(event, clientUserAgent); err != nil {
			logging.Warnf("Unable to set user-agent from header to event object: %v", err)
		}
	}
}

//Postprocess puts event into recognition Service
func (jp *JsProcessor) Postprocess(event Event, eventID string, destinationIDs []string) {
	jp.usersRecognition.Event(event, eventID, destinationIDs)
}

//Type returns preprocessor type
func (jp *JsProcessor) Type() string {
	return JSPreprocessorType
}
