package cors

import (
	"golang.org/x/net/publicsuffix"
	"strings"
)

const (
	//AppTopLevelDomainTemplate matches when host top level domain == origin top level domain (abc.com == abc.com)
	AppTopLevelDomainTemplate = "{{APP_TLD}}"
	//AppSecondLevelDomainTemplate matches any origin domain if host top level domain == origin top level domain (app.abc.com == noapp.abc.com)
	AppSecondLevelDomainTemplate = "*.{{APP_TLD}}"
)

//AppDomainRule replaced AppTopLevelDomainTemplate with input HOST header and uses PrefixSuffixRule
type AppDomainRule struct {
	expression string
}

//IsAllowed returns true if reqOrigin matches the rule
func (adr *AppDomainRule) IsAllowed(host, reqOrigin string) bool {
	host = removePort(host)
	reqOrigin = removePort(reqOrigin)
	reqOrigin = removeSchema(reqOrigin)

	hostTopLevelDomain, hostDomain := ExtractTopLevelAndDomain(host)

	originTopLevelDomain, originDomain := ExtractTopLevelAndDomain(reqOrigin)

	expressionTopLevelDomain, expressionDomain := ExtractTopLevelAndDomain(adr.expression)

	//analyze only top level domain
	if expressionDomain == "" {
		expression := strings.ReplaceAll(expressionTopLevelDomain, AppTopLevelDomainTemplate, hostTopLevelDomain)
		return NewPrefixSuffixRule(expression).IsAllowed("", originTopLevelDomain)
	}

	//analyze only domain
	return hostTopLevelDomain == originTopLevelDomain && originDomain != "" && NewPrefixSuffixRule(expressionDomain).IsAllowed(hostDomain, originDomain)

}

//ExtractTopLevelAndDomain returns top level domain and domain
//e.g. abc.efg.com returns "efg.com", "abc"
func ExtractTopLevelAndDomain(adr string) (string, string) {
	var icann, topLevelDomain, domain string

	for i := 0; i < 3; i++ {
		if adr == "" {
			break
		}

		adr = strings.TrimSuffix(adr, ".")
		publicSuffix, isIcann := publicsuffix.PublicSuffix(adr)
		if isIcann && topLevelDomain == "" {
			icann = publicSuffix
		} else if topLevelDomain == "" {
			topLevelDomain = publicSuffix
		} else {
			domain = publicSuffix
		}

		adr = strings.TrimSuffix(adr, publicSuffix)
	}

	if icann != "" {
		topLevelDomain += "." + icann
	}

	return topLevelDomain, domain
}
