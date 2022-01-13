package users

import "github.com/jitsucom/jitsu/server/events"

//RecognitionPayload is a queue dto
type RecognitionPayload struct {
	Event          events.Event
	EventID        string
	DestinationIDs []string
}

//EventIdentifiers is used for holding event identifiers
type EventIdentifiers struct {
	AnonymousID          string
	EventID              string
	IdentificationValues map[string]interface{}
}

func (ei *EventIdentifiers) IsAnyIdentificationValueFilled() bool {
	for _, value := range ei.IdentificationValues {
		if value != nil {
			return true
		}
	}

	return false
}
