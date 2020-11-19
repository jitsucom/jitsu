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

func (d *Dummy) SuccessEvent(destinationId string, now time.Time) error {
	return nil
}
func (d *Dummy) ErrorEvent(destinationId string, now time.Time) error {
	return nil
}

func (d *Dummy) AddEvent(destinationId, eventId, payload string, now time.Time) (int, error) {
	return 0, nil
}
func (d *Dummy) UpdateEvent(destinationId, eventId, success, error string) error {
	return nil
}
func (d *Dummy) RemoveLastEvent(destinationId string) error {
	return nil
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
