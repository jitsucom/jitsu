package enrichment

import (
	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/jsonutils"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/maputils"
	"github.com/jitsucom/jitsu/server/parsers"
	"github.com/jitsucom/jitsu/server/useragent"
	"sync"
)

const UserAgentParse = "user_agent_parse"

//UserAgentParseRule is a user-agent parse rule with cache
type UserAgentParseRule struct {
	source                  jsonutils.JSONPath
	destination             jsonutils.JSONPath
	uaResolver              useragent.Resolver
	enrichmentConditionFunc func(map[string]interface{}) bool

	mutex *sync.RWMutex
	cache map[string]map[string]interface{}
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
		mutex: &sync.RWMutex{},
		cache: map[string]map[string]interface{}{},
	}, nil
}

//Execute sets parsed ua from cache or resolves with useragent.Resolver. Also returns set value to destination path
func (uap *UserAgentParseRule) Execute(event map[string]interface{}) map[string]interface{} {
	if !uap.enrichmentConditionFunc(event) {
		return nil
	}

	uaIface, ok := uap.source.Get(event)
	if !ok {
		return nil
	}

	ua, ok := uaIface.(string)
	if !ok {
		return nil
	}

	uap.mutex.RLock()
	parsedUAMap, ok := uap.cache[ua]
	uap.mutex.RUnlock()
	if !ok {
		parsedUa := uap.uaResolver.Resolve(ua)

		var err error
		//convert all structs to map[string]interface{} for inner typecasting
		parsedUAMap, err = parsers.ParseInterface(parsedUa)
		if err != nil {
			logging.SystemErrorf("Error converting ua parse node: %v", err)
			return nil
		}
		uap.mutex.Lock()
		uap.cache[ua] = parsedUAMap
		uap.mutex.Unlock()
	}

	result := maputils.CopyMap(parsedUAMap)
	//don't overwrite existent
	err := uap.destination.SetIfNotExist(event, result)
	if err != nil {
		logging.SystemErrorf("Resolved useragent data wasn't set: %v", err)
	}
	return result
}

func (uap *UserAgentParseRule) Name() string {
	return UserAgentParse
}

func (uap *UserAgentParseRule) DstPath() jsonutils.JSONPath {
	return uap.destination
}
