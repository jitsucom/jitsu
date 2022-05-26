package enrichment

import (
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/geo"
	"github.com/jitsucom/jitsu/server/jsonutils"
	"github.com/jitsucom/jitsu/server/logging"
)

var (
	DefaultSrcIP jsonutils.JSONPath
	DefaultDstIP jsonutils.JSONPath

	DefaultJsUaRule  = &UserAgentParseRule{}
	DefaultAPIUaRule = &UserAgentParseRule{}
)

//InitDefault initializes default lookup enrichment rules
func InitDefault(srcIP, dstIP, srcJsUA, srcAPIUA, dstUA string) {
	DefaultSrcIP = jsonutils.NewJSONPath(srcIP)
	DefaultDstIP = jsonutils.NewJSONPath(dstIP)

	var err error
	DefaultJsUaRule, err = newUserAgentParseRule(
		jsonutils.NewJSONPath(srcJsUA),
		jsonutils.NewJSONPath(dstUA),
		func(m map[string]interface{}) bool {
			src := events.ExtractSrc(m)
			return src != "api"
		})
	DefaultAPIUaRule, err = newUserAgentParseRule(
		jsonutils.NewJSONPath(srcAPIUA),
		jsonutils.NewJSONPath(dstUA),
		func(m map[string]interface{}) bool {
			src := events.ExtractSrc(m)
			return src == "api"
		})
	if err != nil {
		logging.Fatalf("Failed to create default JS user-agent rule: %v", err)
	}
}

func CreateDefaultJsIPRule(geoService *geo.Service, geoDataResolverID string) *IPLookupRule {
	ipLookupRule, _ := NewIPLookupRule(DefaultSrcIP, DefaultDstIP, geoService, geoDataResolverID)
	return ipLookupRule
}
