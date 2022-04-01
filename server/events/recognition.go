package events

type Recognition interface {
	Event(event Event, eventID string, destinationIDs []string, tokenID string)
}

type DummyRecognition struct{}

func (d *DummyRecognition) Event(event Event, eventID string, destinationIDs []string, tokenID string) {
}
