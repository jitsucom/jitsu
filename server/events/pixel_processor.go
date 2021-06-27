package events

import (
	"net/http"

	"github.com/jitsucom/jitsu/server/jsonutils"
	"github.com/jitsucom/jitsu/server/timestamp"
)

// PixelProcessor preprocess tracking pixel events
type PixelProcessor struct {
}

// NewPixelProcessor returns configured PixelProcessor
func NewPixelProcessor() Processor {
	return &PixelProcessor{}
}

// Preprocess set user-agent from request header to configured nodes
func (pp *PixelProcessor) Preprocess(event Event, r *http.Request) {
	compatibility := false
	if _, ok := event["compat"]; ok {
		compatibility = true
	}

	urlField := "url"
	hostField := "doc_host"
	pathField := "doc_path"
	searchField := "doc_search"
	userIdField := "user/anonymous_id"
	agentField := "user_agent"
	timeField := "utc_time"
	if compatibility {
		urlField = "eventn_ctx/url"
		hostField = "eventn_ctx/doc_host"
		pathField = "eventn_ctx/doc_path"
		searchField = "eventn_ctx/doc_search"
		userIdField = "eventn_ctx/user/anonymous_id"
		agentField = "eventn_ctx/user_agent"
		timeField = "eventn_ctx/utc_time"
	}

	path := jsonutils.NewJSONPath(urlField)
	if _, exist := path.Get(event); !exist {
		path.Set(event, r.RemoteAddr)
	}

	path = jsonutils.NewJSONPath(hostField)
	if _, exist := path.Get(event); !exist {
		path.Set(event, r.Host)
	}

	path = jsonutils.NewJSONPath(pathField)
	if _, exist := path.Get(event); !exist {
		path.Set(event, r.URL.Path)
	}

	path = jsonutils.NewJSONPath(searchField)
	if _, exist := path.Get(event); !exist {
		path.Set(event, r.URL.RawQuery)
	}

	path = jsonutils.NewJSONPath(userIdField)
	if _, exist := path.Get(event); !exist {
		domain, ok := event["cookie_domain"]
		if !ok {
			domain = r.Host
		}

		if domain_str, ok := domain.(string); ok {
			cookie, err := r.Cookie(domain_str)
			if err == nil && cookie != nil {
				path.Set(event, cookie.Value)
			}
		}
	}

	path = jsonutils.NewJSONPath(agentField)
	if _, exist := path.Get(event); !exist {
		path.Set(event, r.UserAgent())
	}

	path = jsonutils.NewJSONPath(timeField)
	if _, exist := path.Get(event); !exist {
		path.Set(event, timestamp.NowUTC())
	}

	event[SrcKey] = "jitsu_gif"
}

func (pp *PixelProcessor) Postprocess(event Event, eventID string, destinationIDs []string) {
}

// Type returns preprocessor type
func (pp *PixelProcessor) Type() string {
	return PixelPreprocessorType
}
