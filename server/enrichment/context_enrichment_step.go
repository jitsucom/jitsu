package enrichment

import (
	"fmt"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/identifiers"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/timestamp"
	"github.com/jitsucom/jitsu/server/uuid"
)

const (
	ApiTokenKey = "api_key"
	IPKey       = "source_ip"
)

//ContextEnrichmentStep enriches payload with ip, user-agent, token, unique ID field (event_id) and _timestamp
func ContextEnrichmentStep(payload events.Event, token string, reqContext *events.RequestContext, preprocessor events.Processor,
	uniqueIDField *identifiers.UniqueID) {
	//1. source IP (don't override income value)
	if _, ok := payload[IPKey]; !ok {
		if reqContext.ClientIP != "" {
			payload[IPKey] = reqContext.ClientIP
		}
	}

	//2. preprocess
	preprocessor.Preprocess(payload, reqContext)

	//3. unique ID field
	//extract 1.0 format -> 1.0 flat format -> 2.0 format
	eventID := uniqueIDField.ExtractAndRemove(payload)
	if eventID == "" {
		eventID = uuid.New()
	}
	//set into flat field
	if err := uniqueIDField.Set(payload, fmt.Sprint(eventID)); err != nil {
		logging.SystemError("Error setting flat unique ID into the object %s: %v", payload.Serialize(), err)
	}

	//4. timestamp & api key
	if _, ok := payload[ApiTokenKey]; !ok {
		payload[ApiTokenKey] = token
	}
	if _, ok := payload[timestamp.Key]; !ok {
		payload[timestamp.Key] = timestamp.NowUTC()
	}
}
