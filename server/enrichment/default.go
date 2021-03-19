package enrichment

import (
	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/jsonutils"
)

var (
	DefaultJsIpRule = &IpLookupRule{}
	DefaultJsUaRule = &UserAgentParseRule{}
)

//initializing default lookup enrichment rules.
//must be called after appconfig.Init()
func InitDefault() {
	DefaultJsIpRule = &IpLookupRule{
		source:      jsonutils.NewJsonPath("/source_ip"),
		destination: jsonutils.NewJsonPath("/eventn_ctx/location"),
		geoResolver: appconfig.Instance.GeoResolver,
		enrichmentConditionFunc: func(m map[string]interface{}) bool {
			src := events.ExtractSrc(m)
			return src != "api"
		}}
	DefaultJsUaRule = &UserAgentParseRule{
		source:      jsonutils.NewJsonPath("/eventn_ctx/user_agent"),
		destination: jsonutils.NewJsonPath("/eventn_ctx/parsed_ua"),
		uaResolver:  appconfig.Instance.UaResolver,
		enrichmentConditionFunc: func(m map[string]interface{}) bool {
			src := events.ExtractSrc(m)
			return src != "api"
		}}
}
