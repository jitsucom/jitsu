package enrichment

import (
	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/jsonutils"
)

var (
	DefaultJsIPRule = &IPLookupRule{}
	DefaultJsUaRule = &UserAgentParseRule{}
)

//initializing default lookup enrichment rules.
//must be called after appconfig.Init()
func InitDefault() {
	DefaultJsIPRule = &IPLookupRule{
		source:      jsonutils.NewJSONPath("/source_ip"),
		destination: jsonutils.NewJSONPath("/eventn_ctx/location"),
		geoResolver: appconfig.Instance.GeoResolver,
		enrichmentConditionFunc: func(m map[string]interface{}) bool {
			src := events.ExtractSrc(m)
			return src != "api"
		}}
	DefaultJsUaRule = &UserAgentParseRule{
		source:      jsonutils.NewJSONPath("/eventn_ctx/user_agent"),
		destination: jsonutils.NewJSONPath("/eventn_ctx/parsed_ua"),
		uaResolver:  appconfig.Instance.UaResolver,
		enrichmentConditionFunc: func(m map[string]interface{}) bool {
			src := events.ExtractSrc(m)
			return src != "api"
		}}
}
