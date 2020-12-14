package enrichment

type LookupEnrichmentStep struct {
	enrichmentRules []Rule
}

func NewLookupEnrichmentStep(enrichmentRules []Rule) *LookupEnrichmentStep {
	return &LookupEnrichmentStep{enrichmentRules: enrichmentRules}
}

func (les *LookupEnrichmentStep) Execute(object map[string]interface{}) {
	for _, rule := range les.enrichmentRules {
		rule.Execute(object)
	}
}
