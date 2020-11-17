package enrichment

import (
	"github.com/jitsucom/eventnative/appconfig"
	"github.com/jitsucom/eventnative/jsonutils"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/useragent"
)

const UserAgentParse = "user_agent_parse"

type UserAgentParseRule struct {
	source      *jsonutils.JsonPath
	destination *jsonutils.JsonPath
	uaResolver  useragent.Resolver
}

func NewUserAgentParseRule(source, destination *jsonutils.JsonPath) (*UserAgentParseRule, error) {
	return &UserAgentParseRule{source: source, destination: destination, uaResolver: appconfig.Instance.UaResolver}, nil
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

	ok = uap.destination.Set(fact, parsedUa)
	if !ok {
		logging.SystemError("Resolved useragent data wasn't set in path: %s", uap.destination.String())
	}

	return nil
}
