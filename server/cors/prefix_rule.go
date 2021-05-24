package cors

import (
	"net/url"
	"strings"
)

//Rule is a CORS rule
type Rule interface {
	IsAllowed(host, origin string) bool
}

//NewRule returns Rule based on expression
func NewRule(expression string) Rule {
	if strings.Contains(expression, AppTopLevelDomainTemplate) {
		return &AppDomainRule{expression: expression}
	}

	return NewPrefixSuffixRule(expression)
}

//PrefixSuffixRule checks domain by prefix abc* and suffix: *.abc.com
type PrefixSuffixRule struct {
	prefix   bool
	suffix   bool
	wildcard bool
	value    string
}

//NewPrefixSuffixRule returns PrefixSuffixRule
func NewPrefixSuffixRule(expression string) Rule {
	if expression == "*" {
		return &PrefixSuffixRule{wildcard: true}
	}

	var prefix, suffix bool
	//check
	if strings.HasPrefix(expression, "*") {
		expression = strings.Replace(expression, "*", "", 1)
		prefix = true
	}

	if strings.HasSuffix(expression, "*") {
		expression = strings.Replace(expression, "*", "", 1)
		suffix = true
	}

	return &PrefixSuffixRule{prefix: prefix, suffix: suffix, value: expression}
}

//IsAllowed returns true if reqOrigin matches the rule
func (psr *PrefixSuffixRule) IsAllowed(host, reqOrigin string) bool {
	if psr.wildcard {
		return true
	}

	reqOrigin = removePort(reqOrigin)
	reqOrigin = removeSchema(reqOrigin)

	//prefix means '*abc.ru' and we need to check if abc.ru is the suffix of origin
	if psr.prefix {
		return strings.HasSuffix(reqOrigin, psr.value)
	}

	//prefix means 'abc*' and we need to check if abc is the prefix of origin
	if psr.suffix {
		return strings.HasPrefix(reqOrigin, psr.value)
	}

	return reqOrigin == psr.value
}

func removeSchema(adr string) string {
	if strings.HasPrefix(adr, "http://") {
		adr = strings.Replace(adr, "http://", "", 1)
	}
	if strings.HasPrefix(adr, "https://") {
		adr = strings.Replace(adr, "https://", "", 1)
	}

	return adr
}

func removePort(adr string) string {
	if strings.Contains(adr, ":") {
		u, err := url.Parse(adr)
		if err == nil {
			return strings.Split(u.Host, ":")[0]
		}
	}

	return adr
}
