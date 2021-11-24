package users

//RecognitionPayload is a queue dto
type RecognitionPayload struct {
	EventBytes []byte
	//map[destinationID]EventIdentifiers
	DestinationsIdentifiers map[string]EventIdentifiers
}

//EventIdentifiers is used for holding event identifiers
type EventIdentifiers struct {
	AnonymousID          string
	EventID              string
	IdentificationValues map[string]interface{}
}

func (ei *EventIdentifiers) IsAllIdentificationValuesFilled() bool {
	for _, value := range ei.IdentificationValues {
		if value == nil {
			return false
		}
	}

	return true
}
