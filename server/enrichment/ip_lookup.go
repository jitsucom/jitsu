package enrichment

import (
	"github.com/jitsucom/jitsu/server/parsers"
	"strings"

	"github.com/jitsucom/jitsu/server/geo"
	"github.com/jitsucom/jitsu/server/jsonutils"
	"github.com/jitsucom/jitsu/server/logging"
)

const IPLookup = "ip_lookup"

type IPLookupRule struct {
	source                  jsonutils.JSONPath
	destination             jsonutils.JSONPath
	geoResolverID           string
	geoService              *geo.Service
	enrichmentConditionFunc func(map[string]interface{}) bool
}

func NewIPLookupRule(source, destination jsonutils.JSONPath, geoService *geo.Service, geoResolverID string) (*IPLookupRule, error) {
	return &IPLookupRule{
		source:        source,
		destination:   destination,
		geoService:    geoService,
		geoResolverID: geoResolverID,
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
			logging.Errorf("Error resolving geo ip [%s]: %v", ip, err)
		}
		return
	}

	//convert all structs to map[string]interface{} for inner typecasting
	result, err := parsers.ParseInterface(geoData)
	if err != nil {
		logging.SystemErrorf("Error converting geo ip node: %v", err)
		return
	}

	// Merge destination values from event and from geo resolver
	if err = ir.destination.SetOrMergeIfExist(event, result); err != nil {
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

	resolver := ir.geoService.GetGeoResolver(ir.geoResolverID)

	for _, ip := range ips {
		data, err = resolver.Resolve(ip)
		//return first without error
		if err == nil {
			return data, err
		}
	}

	return
}
