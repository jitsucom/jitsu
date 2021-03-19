package schema

type DummyFlattener struct {
}

func NewDummyFlattener() *DummyFlattener {
	return &DummyFlattener{}
}

//FlattenObject return the same json object
func (df *DummyFlattener) FlattenObject(json map[string]interface{}) (map[string]interface{}, error) {
	return json, nil
}
