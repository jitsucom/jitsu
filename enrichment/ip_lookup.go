package enrichment

import (
	"github.com/jitsucom/eventnative/appconfig"
	"github.com/jitsucom/eventnative/geo"
	"github.com/jitsucom/eventnative/jsonutils"
	"github.com/jitsucom/eventnative/logging"
)

const IpLookup = "ip_lookup"

type IpLookupRule struct {
	source      *jsonutils.JsonPath
	destination *jsonutils.JsonPath
	geoResolver geo.Resolver
}

func NewIpLookupRule(source, destination *jsonutils.JsonPath) (*IpLookupRule, error) {
	return &IpLookupRule{source: source, destination: destination, geoResolver: appconfig.Instance.GeoResolver}, nil
}

func (ir *IpLookupRule) Execute(fact map[string]interface{}) error {
	ipIface, ok := ir.source.Get(fact)
	if !ok {
		return nil
	}

	ip, ok := ipIface.(string)
	if !ok {
		return nil
	}

	geoData, err := ir.geoResolver.Resolve(ip)
	if err != nil {
		logging.SystemErrorf("Error resolving geo ip [%s]: %v", ip, err)
		return nil
	}

	ok = ir.destination.Set(fact, geoData)
	if !ok {
		logging.SystemError("Resolved geo data wasn't set in path: %s", ir.destination.String())
	}

	return nil
}
