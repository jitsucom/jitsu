package cors

import (
	jcors "github.com/jitsucom/jitsu/server/cors"
)

//Instance is a CORS rule slice singleton
var Instance *Service

//Service is an dto for keeping CORS Rule slice
type Service struct {
	rules []jcors.Rule
}

//Init initializes cors.Service instance
func Init(allowedDomain string, rules []string) {
	var corsRules []jcors.Rule
	if allowedDomain != "" {
		corsRules = append(corsRules, jcors.NewRule(allowedDomain))
	}

	for _, rule := range rules {
		if rule != "" {
			corsRules = append(corsRules, jcors.NewRule(rule))
		}
	}

	Instance = &Service{rules: corsRules}
}

//IsAllowedByRules returns true if origin allowed by any rule
func (s *Service) IsAllowedByRules(host, reqOrigin string) bool {
	for _, rule := range s.rules {
		if rule.IsAllowed(host, reqOrigin) {
			return true
		}
	}

	return false
}
