package enrichment

import (
	lru "github.com/hashicorp/golang-lru"
	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/jsonutils"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/maputils"
	"github.com/jitsucom/jitsu/server/parsers"
	"github.com/jitsucom/jitsu/server/useragent"
	"github.com/pkg/errors"
)

const UserAgentParse = "user_agent_parse"

type ConditionFunc func(map[string]interface{}) bool

//UserAgentParseRule is a user-agent parse rule with cache
type UserAgentParseRule struct {
	source                  jsonutils.JSONPath
	destination             jsonutils.JSONPath
	uaResolver              useragent.Resolver
	enrichmentConditionFunc ConditionFunc
	cache                   *lru.TwoQueueCache
}

func NewUserAgentParseRule(source, destination jsonutils.JSONPath) (*UserAgentParseRule, error) {
	//always do enrichment
	conditionFunc := func(m map[string]interface{}) bool { return true }
	return newUserAgentParseRule(source, destination, conditionFunc)
}

func newUserAgentParseRule(source, destination jsonutils.JSONPath, conditionFunc ConditionFunc) (*UserAgentParseRule, error) {
	cache, err := lru.New2Q(100_000)
	if err != nil {
		return nil, errors.Wrap(err, "create user-agent cache error")
	}

	return &UserAgentParseRule{
		source:                  source,
		destination:             destination,
		uaResolver:              appconfig.Instance.UaResolver,
		enrichmentConditionFunc: conditionFunc,
		cache:                   cache,
	}, nil
}

//Execute sets parsed ua from cache or resolves with useragent.Resolver. Also returns set value to destination path
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

	parsedUAMap, ok := uap.cache.Get(ua)
	if !ok {
		parsedUa := uap.uaResolver.Resolve(ua)

		var err error
		//convert all structs to map[string]interface{} for inner typecasting
		parsedUAMap, err = parsers.ParseInterface(parsedUa)
		if err != nil {
			logging.SystemErrorf("Error converting ua parse node: %v", err)
			return
		}
		uap.cache.Add(ua, parsedUAMap)
	}

	//don't overwrite existent
	err := uap.destination.SetIfNotExist(event, maputils.CopyMap(parsedUAMap.(map[string]interface{})))
	if err != nil {
		logging.SystemErrorf("Resolved useragent data wasn't set: %v", err)
	}
}

func (uap *UserAgentParseRule) Name() string {
	return UserAgentParse
}

func (uap *UserAgentParseRule) DstPath() jsonutils.JSONPath {
	return uap.destination
}
