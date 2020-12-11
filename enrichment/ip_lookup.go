package enrichment

import (
	"github.com/jitsucom/eventnative/appconfig"
	"github.com/jitsucom/eventnative/geo"
	"github.com/jitsucom/eventnative/jsonutils"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/parsers"
)

const IpLookup = "ip_lookup"

type IpLookupRule struct {
	source                  *jsonutils.JsonPath
	destination             *jsonutils.JsonPath
	geoResolver             geo.Resolver
	enrichmentConditionFunc func(map[string]interface{}) bool
}

func NewIpLookupRule(source, destination *jsonutils.JsonPath) (*IpLookupRule, error) {
	return &IpLookupRule{
		source:      source,
		destination: destination,
		geoResolver: appconfig.Instance.GeoResolver,
		//always do enrichment
		enrichmentConditionFunc: func(m map[string]interface{}) bool {
			return true
		},
	}, nil
}

func (ir *IpLookupRule) Execute(event map[string]interface{}) {
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
		logging.SystemErrorf("Error resolving geo ip [%s]: %v", ip, err)
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

func (ir *IpLookupRule) Name() string {
	return IpLookup
}
