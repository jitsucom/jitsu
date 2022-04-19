package enrichment

import (
	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/geo"
	"github.com/jitsucom/jitsu/server/jsonutils"
	"sync"
)

var (
	DefaultSrcIP jsonutils.JSONPath
	DefaultDstIP jsonutils.JSONPath

	DefaultJsUaRule = &UserAgentParseRule{}
)

//InitDefault initializes default lookup enrichment rules
func InitDefault(srcIP, dstIP, srcUA, dstUA string) {
	DefaultSrcIP = jsonutils.NewJSONPath(srcIP)
	DefaultDstIP = jsonutils.NewJSONPath(dstIP)

	DefaultJsUaRule = &UserAgentParseRule{
		source:      jsonutils.NewJSONPath(srcUA),
		destination: jsonutils.NewJSONPath(dstUA),
		uaResolver:  appconfig.Instance.UaResolver,
		enrichmentConditionFunc: func(m map[string]interface{}) bool {
			src := events.ExtractSrc(m)
			return src != "api"
		},
		mutex: &sync.RWMutex{},
		cache: map[string]map[string]interface{}{},
	}
}

func CreateDefaultJsIPRule(geoService *geo.Service, geoDataResolverID string) *IPLookupRule {
	ipLookupRule, _ := NewIPLookupRule(DefaultSrcIP, DefaultDstIP, geoService, geoDataResolverID)
	return ipLookupRule
}
