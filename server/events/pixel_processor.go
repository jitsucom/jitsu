package events

import (
	"github.com/jitsucom/jitsu/server/jsonutils"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/timestamp"
	"net/url"
)

const (
	compatField = "compat"
)

// PixelProcessor preprocess tracking pixel events
type PixelProcessor struct {
	urlField                jsonutils.JSONPath
	hostField               jsonutils.JSONPath
	docPathField            jsonutils.JSONPath
	docSearchField          jsonutils.JSONPath
	userAnonymIDField       jsonutils.JSONPath
	userHashedAnonymIDField jsonutils.JSONPath
	userAgentField          jsonutils.JSONPath
	utcTimeField            jsonutils.JSONPath

	//compat
	compatURLField                jsonutils.JSONPath
	compatHostField               jsonutils.JSONPath
	compatDocPathField            jsonutils.JSONPath
	compatDocSearchField          jsonutils.JSONPath
	compatUserAnonymIDField       jsonutils.JSONPath
	compatHashedUserAnonymIDField jsonutils.JSONPath
	compatUserAgentField          jsonutils.JSONPath
	compatUTCTimeField            jsonutils.JSONPath
}

// NewPixelProcessor returns configured PixelProcessor
func NewPixelProcessor() *PixelProcessor {
	return &PixelProcessor{
		urlField:                jsonutils.NewJSONPath("/url"),
		hostField:               jsonutils.NewJSONPath("/doc_host"),
		docPathField:            jsonutils.NewJSONPath("/doc_path"),
		docSearchField:          jsonutils.NewJSONPath("/doc_search"),
		userAnonymIDField:       jsonutils.NewJSONPath("/user/anonymous_id"),
		userHashedAnonymIDField: jsonutils.NewJSONPath("/user/hashed_anonymous_id"),
		userAgentField:          jsonutils.NewJSONPath("/user_agent"),
		utcTimeField:            jsonutils.NewJSONPath("/utc_time"),

		compatURLField:                jsonutils.NewJSONPath("/eventn_ctx/url"),
		compatHostField:               jsonutils.NewJSONPath("/eventn_ctx/doc_host"),
		compatDocPathField:            jsonutils.NewJSONPath("/eventn_ctx/doc_path"),
		compatDocSearchField:          jsonutils.NewJSONPath("/eventn_ctx/doc_search"),
		compatUserAnonymIDField:       jsonutils.NewJSONPath("/eventn_ctx/user/anonymous_id"),
		compatHashedUserAnonymIDField: jsonutils.NewJSONPath("/eventn_ctx/user/hashed_anonymous_id"),
		compatUserAgentField:          jsonutils.NewJSONPath("/eventn_ctx/user_agent"),
		compatUTCTimeField:            jsonutils.NewJSONPath("/eventn_ctx/utc_time"),
	}
}

// Preprocess set some values from request header into event
func (pp *PixelProcessor) Preprocess(event Event, reqContext *RequestContext) {
	compatibilityMode := false
	if _, ok := event[compatField]; ok {
		compatibilityMode = true
	}

	referer := reqContext.Referer
	refURL, err := url.Parse(referer)
	if err != nil {
		logging.SystemErrorf("error parsing Referer [%s] in pixel processor: %v", referer, err)
		refURL = &url.URL{}
	}
	host := refURL.Host
	docPath := refURL.Path
	docSearch := refURL.RawQuery
	userAgent := reqContext.UserAgent
	utcTime := timestamp.NowUTC()
	anonymID := reqContext.JitsuAnonymousID
	hashedAnonymID := reqContext.HashedAnonymousID

	if anonymID == "" {
		logging.SystemError("anonym ID value wasn't found in the context")
	}

	if compatibilityMode {
		pp.setIfNotExist(pp.compatURLField, event, referer)
		pp.setIfNotExist(pp.compatHostField, event, host)
		pp.setIfNotExist(pp.compatDocPathField, event, docPath)
		pp.setIfNotExist(pp.compatDocSearchField, event, docSearch)
		pp.setIfNotExist(pp.compatUserAgentField, event, userAgent)
		pp.setIfNotExist(pp.compatUTCTimeField, event, utcTime)
		pp.setIfNotExist(pp.compatUserAnonymIDField, event, anonymID)
		pp.setIfNotExist(pp.compatHashedUserAnonymIDField, event, hashedAnonymID)
	} else {
		pp.setIfNotExist(pp.urlField, event, referer)
		pp.setIfNotExist(pp.hostField, event, host)
		pp.setIfNotExist(pp.docPathField, event, docPath)
		pp.setIfNotExist(pp.docSearchField, event, docSearch)
		pp.setIfNotExist(pp.userAgentField, event, userAgent)
		pp.setIfNotExist(pp.utcTimeField, event, utcTime)
		pp.setIfNotExist(pp.userAnonymIDField, event, anonymID)
		pp.setIfNotExist(pp.userHashedAnonymIDField, event, hashedAnonymID)
	}

	event[SrcKey] = "jitsu_gif"
}

func (pp *PixelProcessor) Postprocess(event Event, eventID string, destinationIDs []string, tokenID string) {
}

// Type returns preprocessor type
func (pp *PixelProcessor) Type() string {
	return pixelPreprocessorType
}

//setIfNotExist uses JSONPath SetIfNotExist func and log error if occurred
func (pp *PixelProcessor) setIfNotExist(path jsonutils.JSONPath, event Event, value interface{}) {
	if err := path.SetIfNotExist(event, value); err != nil {
		logging.Errorf("Error setting %v into event %s by path %s: %v", value, event.DebugString(), path.String(), err)
	}
}
