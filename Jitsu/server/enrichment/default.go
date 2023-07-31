package enrichment

import (
	"github.com/jitsucom/jitsu/server/geo"
	"github.com/jitsucom/jitsu/server/jsonutils"
	"github.com/jitsucom/jitsu/server/logging"
)

var (
	DefaultSrcIP jsonutils.JSONPath
	DefaultDstIP jsonutils.JSONPath

	DefaultUaRule = &UserAgentParseRule{}
)

//InitDefault initializes default lookup enrichment rules
func InitDefault(srcIP, dstIP, srcUA, dstUA string) {
	DefaultSrcIP = jsonutils.NewJSONPath(srcIP)
	DefaultDstIP = jsonutils.NewJSONPath(dstIP)

	var err error
	DefaultUaRule, err = newUserAgentParseRule(
		jsonutils.NewJSONPath(srcUA),
		jsonutils.NewJSONPath(dstUA),
		func(m map[string]interface{}) bool {
			return true
		})
	if err != nil {
		logging.Fatalf("Failed to create default JS user-agent rule: %v", err)
	}
}

func CreateDefaultJsIPRule(geoService *geo.Service, geoDataResolverID string) *IPLookupRule {
	ipLookupRule, _ := NewIPLookupRule(DefaultSrcIP, DefaultDstIP, geoService, geoDataResolverID)
	return ipLookupRule
}
