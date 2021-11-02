package schema

type StronglyTypedMarshaller interface {
	Marshal(bh *BatchHeader, data []map[string]interface{}) ([]byte, error)
}
