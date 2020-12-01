package meta

import "time"

type Dummy struct {
}

func (d *Dummy) GetSignature(sourceId, collection, interval string) (string, error) {
	return "", nil
}

func (d *Dummy) SaveSignature(sourceId, collection, interval, signature string) error {
	return nil
}

func (d *Dummy) GetCollectionStatus(sourceId, collection string) (string, error) {
	return "", nil
}

func (d *Dummy) SaveCollectionStatus(sourceId, collection, status string) error {
	return nil
}

func (d *Dummy) GetCollectionLog(sourceId, collection string) (string, error) {
	return "", nil
}

func (d *Dummy) SaveCollectionLog(sourceId, collection, log string) error {
	return nil
}

func (d *Dummy) SuccessEvents(destinationId string, now time.Time, value int) error {
	return nil
}
func (d *Dummy) ErrorEvents(destinationId string, now time.Time, value int) error {
	return nil
}

func (d *Dummy) AddEvent(destinationId, eventId, payload string, now time.Time) (int, error) {
	return 0, nil
}

func (d *Dummy) UpdateSucceedEvent(destinationId, eventId, success string) error {
	return nil
}

func (d *Dummy) UpdateErrorEvent(destinationId, eventId, error string) error {
	return nil
}
func (d *Dummy) RemoveLastEvent(destinationId string) error {
	return nil
}

func (d *Dummy) GetTotalEvents(destinationId string) (int, error) {
	return 0, nil
}

func (d *Dummy) GetEvents(destinationId string, start, end time.Time, n int) ([]Event, error) {
	return []Event{}, nil
}

func (d *Dummy) Type() string {
	return DummyType
}

func (d *Dummy) Close() error {
	return nil
}
