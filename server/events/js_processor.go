package events

import (
	"github.com/jitsucom/jitsu/server/jsonutils"
	"github.com/jitsucom/jitsu/server/logging"
)

//UserAnonymIDPath is used for setting generated user identifier in case of GDPR
var UserAnonymIDPath = jsonutils.NewJSONPath("/eventn_ctx/user/anonymous_id||/user/anonymous_id")

//JsProcessor preprocess client integration events
type JsProcessor struct {
	usersRecognition  Recognition
	userAgentJSONPath jsonutils.JSONPath
}

//NewJsProcessor returns configured JsProcessor
func NewJsProcessor(usersRecognition Recognition, userAgentPath string) *JsProcessor {
	return &JsProcessor{usersRecognition: usersRecognition, userAgentJSONPath: jsonutils.NewJSONPath(userAgentPath)}
}

//Preprocess sets user-agent from request header to configured nodes
//sets user anonymous ID if GDPR
func (jp *JsProcessor) Preprocess(event Event, reqContext *RequestContext) {
	if reqContext.UserAgent != "" {
		if err := jp.userAgentJSONPath.Set(event, reqContext.UserAgent); err != nil {
			logging.Warnf("Unable to set user-agent from header to event object: %v", err)
		}
	}

	if reqContext.CookieLess {
		if err := UserAnonymIDPath.Set(event, reqContext.JitsuAnonymousID); err != nil {
			logging.SystemErrorf("Error setting generated Jitsu anonymous ID: %v", err)
		}
	}
}

//Postprocess puts event into recognition Service
func (jp *JsProcessor) Postprocess(event Event, eventID string, destinationIDs []string) {
	jp.usersRecognition.Event(event, eventID, destinationIDs)
}

//Type returns preprocessor type
func (jp *JsProcessor) Type() string {
	return jsPreprocessorType
}
