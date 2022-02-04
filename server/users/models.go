package users

//RecognitionPayload is a queue dto
type RecognitionPayload struct {
	DestinationIdentifiers map[string]EventIdentifiers
	EventBytes             []byte
}

//EventIdentifiers is used for holding event identifiers
type EventIdentifiers struct {
	AnonymousID                    string
	EventID                        string
	IdentificationValues           map[string]interface{}
	IsAnyIdentificationValueFilled bool
}
