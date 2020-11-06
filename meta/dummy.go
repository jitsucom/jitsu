package meta

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

func (d *Dummy) Type() string {
	return DummyType
}

func (d *Dummy) Close() error {
	return nil
}
