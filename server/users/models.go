package users

//AnonymousPayload is a queue dto
type AnonymousPayload struct {
	EventID    string
	EventKeys  []EventKey
	EventBytes []byte
}

//EventIdentifiers is used for holding event identifiers
type EventIdentifiers struct {
	EventKey             EventKey
	IdentificationValues map[string]interface{}
}

type EventKey struct {
	TokenID       string
	DestinationID string
	AnonymousID   string
}
