package users

//RecognitionPayload is a queue dto
type RecognitionPayload struct {
	EventID              string
	EventKey             EventKey
	AnonymousEventBytes  string
	IdentificationValues map[string]interface{}
}

type EventKey struct {
	TokenID     string
	AnonymousID string
}
