package enrichment

import (
	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/geo"
	"github.com/jitsucom/jitsu/server/jsonutils"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/parsers"
)

const IPLookup = "ip_lookup"

type IPLookupRule struct {
	source                  jsonutils.JSONPath
	destination             jsonutils.JSONPath
	geoResolver             geo.Resolver
	enrichmentConditionFunc func(map[string]interface{}) bool
}

func NewIPLookupRule(source, destination jsonutils.JSONPath) (*IPLookupRule, error) {
	return &IPLookupRule{
		source:      source,
		destination: destination,
		geoResolver: appconfig.Instance.GeoResolver,
		//always do enrichment
		enrichmentConditionFunc: func(m map[string]interface{}) bool {
			return true
		},
	}, nil
}

func (ir *IPLookupRule) Execute(event map[string]interface{}) {
	if !ir.enrichmentConditionFunc(event) {
		return
	}

	ipIface, ok := ir.source.Get(event)
	if !ok {
		return
	}

	ip, ok := ipIface.(string)
	if !ok {
		return
	}

	geoData, err := ir.geoResolver.Resolve(ip)
	if err != nil {
		if err != geo.EmptyIP {
			logging.SystemErrorf("Error resolving geo ip [%s]: %v", ip, err)
		}
		return
	}

	//convert all structs to map[string]interface{} for inner typecasting
	result, err := parsers.ParseInterface(geoData)
	if err != nil {
		logging.SystemErrorf("Error converting geo ip node: %v", err)
		return
	}

	err = ir.destination.Set(event, result)
	if err != nil {
		logging.SystemErrorf("Resolved geo data wasn't set: %v", err)
	}
}

func (ir *IPLookupRule) Name() string {
	return IPLookup
}
