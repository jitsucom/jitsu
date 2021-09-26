package schema


type StronglyTypedMarshaller interface {
	Marshal(bh *BatchHeader, data []map[string]interface{}) ([]byte, error)
}

func NewParquetMarshaller() StronglyTypedMarshaller {
	pm := &ParquetMarshaller{
		GoroutinesCount: 2,
	}
	return pm
}

type ParquetMarshaller struct {
	GoroutinesCount int
}

func (pm *ParquetMarshaller) Marshal(bh *BatchHeader, data []map[string]interface{}) ([]byte, error) {
	var bytes []byte
	return bytes, nil
}

