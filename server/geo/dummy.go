package geo

//DummyResolver is a dummy resolver that does nothing and returns empty geo data
type DummyResolver struct{}

func (dr *DummyResolver) Resolve(ip string) (*Data, error) {
	return nil, nil
}

func (dr *DummyResolver) Type() string {
	return DummyType
}

func (dr *DummyResolver) Close() error {
	return nil
}
