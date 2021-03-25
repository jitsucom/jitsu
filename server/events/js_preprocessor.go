package events

import (
	"github.com/jitsucom/jitsu/server/jsonutils"
	"net/http"
)

type Preprocessor interface {
	Preprocess(event Event, r *http.Request)
}

//JsPreprocessor preprocess client integration events
type JsPreprocessor struct {
	userAgentJSONPath *jsonutils.JSONPath
}

func NewJsPreprocessor() Preprocessor {
	return &JsPreprocessor{userAgentJSONPath: jsonutils.NewJSONPath(EventnKey + "/user_agent")}
}

//Preprocess set user-agent from request header
func (jp *JsPreprocessor) Preprocess(event Event, r *http.Request) {
	clientUserAgent := r.Header.Get("user-agent")
	if clientUserAgent != "" {
		jp.userAgentJSONPath.Set(event, clientUserAgent)
	}
}
