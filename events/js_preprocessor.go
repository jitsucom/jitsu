package events

import (
	"errors"
	"fmt"
	"github.com/jitsucom/eventnative/enrichment"
	"github.com/jitsucom/eventnative/logging"
)

const (
	eventnKey  = "eventn_ctx"
	uaKey      = "user_agent"
	eventIdKey = "event_id"
)

var nilFactErr = errors.New("Input fact can't be nil")

type Preprocessor interface {
	Preprocess(fact Fact) (Fact, error)
}

//JsPreprocessor preprocess client integration events
type JsPreprocessor struct {
	ipLookupRule enrichment.Rule
	uaParseRule  enrichment.Rule
}

func NewJsPreprocessor() (Preprocessor, error) {
	ipLookupRule, err := enrichment.NewRule(enrichment.DefaultJsIpRuleConfig)
	if err != nil {
		return nil, fmt.Errorf("Error creating default js ip lookup enrichment rule: %v", err)
	}

	uaParseRule, err := enrichment.NewRule(enrichment.DefaultJsUaRuleConig)
	if err != nil {
		return nil, fmt.Errorf("Error creating default js ua parse enrichment rule: %v", err)
	}

	return &JsPreprocessor{
		ipLookupRule: ipLookupRule,
		uaParseRule:  uaParseRule,
	}, nil
}

//Preprocess executes default enrichment rules
//return same object
func (jp *JsPreprocessor) Preprocess(fact Fact) (Fact, error) {
	if fact == nil {
		return nil, nilFactErr
	}

	err := jp.ipLookupRule.Execute(fact)
	if err != nil {
		logging.SystemErrorf("Error executing default js ip lookup enrichment rule: %v", err)
	}

	err = jp.uaParseRule.Execute(fact)
	if err != nil {
		logging.SystemErrorf("Error executing default js ua parse enrichment rule: %v", err)
	}

	return fact, nil
}
