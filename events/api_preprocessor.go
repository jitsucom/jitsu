package events

import (
	"errors"
	"fmt"
	"github.com/jitsucom/eventnative/enrichment"
	"github.com/jitsucom/eventnative/geo"
	"github.com/jitsucom/eventnative/jsonutils"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/useragent"
	"github.com/jitsucom/eventnative/uuid"
)

//ApiPreprocessor preprocess server 2 server integration events
type ApiPreprocessor struct {
	ipLookupRule enrichment.Rule
	uaParseRule  enrichment.Rule

	geoDataPath  *jsonutils.JsonPath
	parsedUaPath *jsonutils.JsonPath
}

func NewApiPreprocessor() (Preprocessor, error) {
	ipLookupRule, err := enrichment.NewRule(enrichment.DefaultApiIpRuleConfig)
	if err != nil {
		return nil, fmt.Errorf("Error creating default api ip lookup enrichment rule: %v", err)
	}

	uaParseRule, err := enrichment.NewRule(enrichment.DefaultApiUaRuleConig)
	if err != nil {
		return nil, fmt.Errorf("Error creating default api ua parse enrichment rule: %v", err)
	}

	return &ApiPreprocessor{
		ipLookupRule: ipLookupRule,
		uaParseRule:  uaParseRule,
		geoDataPath:  jsonutils.NewJsonPath("/" + eventIdKey + "/device_ctx/" + geo.GeoDataKey),
		parsedUaPath: jsonutils.NewJsonPath("/" + eventIdKey + "/device_ctx/" + useragent.ParsedUaKey),
	}, nil
}

//Preprocess executes default enrichment rules or skip if geo.GeoDataKey and useragent.ParsedUaKey were provided
//put eventn_ctx_event_id = uuid if not set
//put src = api
//return same object
func (ap *ApiPreprocessor) Preprocess(fact Fact) (Fact, error) {
	if fact == nil {
		return nil, errors.New("Input fact can't be nil")
	}

	fact["src"] = "api"

	//put eventn_ctx_event_id if not set (e.g. It is used for ClickHouse)
	EnrichWithEventId(fact, uuid.New())

	_, ok := ap.geoDataPath.Get(fact)
	if !ok {
		err := ap.ipLookupRule.Execute(fact)
		if err != nil {
			logging.SystemErrorf("Error executing default api ip lookup enrichment rule: %v", err)
		}
	}

	_, ok = ap.parsedUaPath.Get(fact)
	if !ok {
		err := ap.uaParseRule.Execute(fact)
		if err != nil {
			logging.SystemErrorf("Error executing default api ua parse enrichment rule: %v", err)
		}
	}

	return fact, nil
}
