package enrichment

import (
	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/geo"
	"github.com/jitsucom/jitsu/server/jsonutils"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/parsers"
	"strings"
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

	geoData, err := ir.resolve(ip)
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

	//don't overwrite existent
	err = ir.destination.SetIfNotExist(event, result)
	if err != nil {
		logging.SystemErrorf("Resolved geo data wasn't set: %v", err)
	}
}

func (ir *IPLookupRule) Name() string {
	return IPLookup
}

//resolve tries to resolve comma separated ips or plain ip
//returns first result without error
func (ir *IPLookupRule) resolve(ipStr string) (data *geo.Data, err error) {
	ips := []string{ipStr}
	if strings.Contains(ipStr, ",") {
		ips = []string{}
		ipArr := strings.Split(ipStr, ",")
		for _, ipFromAr := range ipArr {
			ips = append(ips, strings.TrimSpace(ipFromAr))
		}
	}

	for _, ip := range ips {
		data, err = ir.geoResolver.Resolve(ip)
		//return first without error
		if err == nil {
			return data, err
		}
	}

	return
}
