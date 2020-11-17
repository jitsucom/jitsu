package enrichment

var (
	DefaultJsIpRuleConfig = &RuleConfig{Name: IpLookup, From: "/source_ip", To: "/eventn_ctx/location"}
	DefaultJsUaRuleConig  = &RuleConfig{Name: UserAgentParse, From: "/eventn_ctx/user_agent", To: "/eventn_ctx/parsed_ua"}

	DefaultApiIpRuleConfig = &RuleConfig{Name: IpLookup, From: "/device_ctx/location/ip", To: "/eventn_ctx/location"}
	DefaultApiUaRuleConig  = &RuleConfig{Name: UserAgentParse, From: "/device_ctx/user_agent", To: "/eventn_ctx/parsed_ua"}
)
