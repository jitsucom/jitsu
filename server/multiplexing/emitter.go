package multiplexing

import (
	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/enrichment"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/identifiers"
)

type Emitter interface {
	GetTokenID() string
	EnrichContext(uniqueIDField *identifiers.UniqueID, payload events.Event)
	RecognizeUsers(eventID string, payload events.Event, destinationIDs []string)
}

type Token struct {
	Context   *events.RequestContext
	Processor events.Processor
	Value     string
}

func (t Token) GetTokenID() string {
	return appconfig.Instance.AuthorizationService.GetTokenID(t.Value)
}

func (t Token) EnrichContext(uniqueIDField *identifiers.UniqueID, payload events.Event) {
	enrichment.ContextEnrichmentStep(payload, t.Value, t.Context, t.Processor, uniqueIDField)
}

func (t Token) RecognizeUsers(eventID string, payload events.Event, destinationIDs []string) {
	t.Processor.Postprocess(payload, eventID, destinationIDs)
}

var System Emitter = system{}

type system struct{}

func (system) GetTokenID() string                                { return "__internal__" }
func (system) EnrichContext(*identifiers.UniqueID, events.Event) {}
func (system) RecognizeUsers(string, events.Event, []string)     {}
