package cors

import (
	"github.com/jitsucom/jitsu/server/logging"
	"golang.org/x/net/publicsuffix"
	"strings"
)

const (
	AppTopLevelDomainTemplate    = "{{APP_TLD}}"
	AppSecondLevelDomainTemplate = "*.{{APP_TLD}}"
)

//AppDomainRule replaced AppTopLevelDomainTemplate with input HOST header and uses PrefixSuffixRule
type AppDomainRule struct {
	expression string
}

//IsAllowed returns true if reqOrigin matches the rule
func (adr *AppDomainRule) IsAllowed(host, reqOrigin string) bool {
	hostPort := strings.Split(host, ":")
	hostWithoutPort := hostPort[0]

	hostTldPlus, err := publicsuffix.EffectiveTLDPlusOne(hostWithoutPort)
	if err != nil {
		logging.SystemErrorf("Error parsing top level domain from Host %s: %v", host, err)
		return false
	}

	hostTopLevelDomain, hostDomain := extractTopLevelAndDomain(hostTldPlus)

	originTopLevelDomain, originDomain := extractTopLevelAndDomain(reqOrigin)

	expressionTopLevelDomain, expressionDomain := extractTopLevelAndDomain(adr.expression)

	//analyze only top level domain
	if expressionDomain == "" {
		expression := strings.ReplaceAll(expressionTopLevelDomain, AppTopLevelDomainTemplate, hostTopLevelDomain)
		return NewPrefixSuffixRule(expression).IsAllowed("", originTopLevelDomain)
	}

	//analyze only domain
	return hostDomain == originDomain && NewPrefixSuffixRule(expressionDomain).IsAllowed(hostDomain, originDomain)

}

//extractTopLevelAndDomain returns top level domain and domain
//e.g. abc.efg.com returns "efg.com", "abc"
func extractTopLevelAndDomain(host string) (string, string) {
	domains := strings.Split(host, ".")
	if len(domains) == 1 {
		return domains[0], ""
	}

	return domains[1], domains[0]
}
