package enrichment

import (
	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/jsonutils"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/parsers"
	"github.com/jitsucom/jitsu/server/useragent"
)

const UserAgentParse = "user_agent_parse"

type UserAgentParseRule struct {
	source                  jsonutils.JSONPath
	destination             jsonutils.JSONPath
	uaResolver              useragent.Resolver
	enrichmentConditionFunc func(map[string]interface{}) bool
}

func NewUserAgentParseRule(source, destination jsonutils.JSONPath) (*UserAgentParseRule, error) {
	return &UserAgentParseRule{
		source:      source,
		destination: destination,
		uaResolver:  appconfig.Instance.UaResolver,
		//always do enrichment
		enrichmentConditionFunc: func(m map[string]interface{}) bool {
			return true
		},
	}, nil
}

func (uap *UserAgentParseRule) Execute(event map[string]interface{}) {
	if !uap.enrichmentConditionFunc(event) {
		return
	}

	uaIface, ok := uap.source.Get(event)
	if !ok {
		return
	}

	ua, ok := uaIface.(string)
	if !ok {
		return
	}

	parsedUa := uap.uaResolver.Resolve(ua)

	//convert all structs to map[string]interface{} for inner typecasting
	result, err := parsers.ParseInterface(parsedUa)
	if err != nil {
		logging.SystemErrorf("Error converting ua parse node: %v", err)
		return
	}

	err = uap.destination.Set(event, result)
	if err != nil {
		logging.SystemErrorf("Resolved useragent data wasn't set: %v", err)
	}
}

func (uap *UserAgentParseRule) Name() string {
	return UserAgentParse
}
