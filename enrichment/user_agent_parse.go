package enrichment

import (
	"github.com/jitsucom/eventnative/appconfig"
	"github.com/jitsucom/eventnative/jsonutils"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/parsers"
	"github.com/jitsucom/eventnative/useragent"
)

const UserAgentParse = "user_agent_parse"

type UserAgentParseRule struct {
	source        *jsonutils.JsonPath
	destination   *jsonutils.JsonPath
	convertResult bool
	uaResolver    useragent.Resolver
}

func NewUserAgentParseRule(source, destination *jsonutils.JsonPath, convertResult bool) (*UserAgentParseRule, error) {
	return &UserAgentParseRule{source: source, destination: destination, convertResult: convertResult, uaResolver: appconfig.Instance.UaResolver}, nil
}

func (uap *UserAgentParseRule) Execute(fact map[string]interface{}) error {
	uaIface, ok := uap.source.Get(fact)
	if !ok {
		return nil
	}

	ua, ok := uaIface.(string)
	if !ok {
		return nil
	}

	parsedUa := uap.uaResolver.Resolve(ua)

	var result interface{}
	result = parsedUa
	if uap.convertResult {
		//convert all structs to map[string]interface{} for inner typecasting
		rawObject, err := parsers.ParseInterface(parsedUa)
		if err != nil {
			logging.SystemErrorf("Error converting ua parse node: %v", err)
			return nil
		}

		result = rawObject
	}

	ok = uap.destination.Set(fact, result)
	if !ok {
		logging.SystemErrorf("Resolved useragent data wasn't set in path: %s", uap.destination.String())
	}

	return nil
}

func (uap *UserAgentParseRule) Name() string {
	return UserAgentParse
}
