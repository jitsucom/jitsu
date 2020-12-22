package events

import (
	"github.com/jitsucom/eventnative/jsonutils"
	"net/http"
)

type Preprocessor interface {
	Preprocess(event Event, r *http.Request)
}

//JsPreprocessor preprocess client integration events
type JsPreprocessor struct {
	userAgentJsonPath *jsonutils.JsonPath
}

func NewJsPreprocessor() Preprocessor {
	return &JsPreprocessor{userAgentJsonPath: jsonutils.NewJsonPath(EventnKey + "/user_agent")}
}

//Preprocess set user-agent from request header
func (jp *JsPreprocessor) Preprocess(event Event, r *http.Request) {
	clientUserAgent := r.Header.Get("user-agent")
	if clientUserAgent != "" {
		jp.userAgentJsonPath.Set(event, clientUserAgent)
	}
}
