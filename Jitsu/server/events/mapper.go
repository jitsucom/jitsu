package events

type Mapper interface {
	Map(object map[string]interface{}) (map[string]interface{}, error)
}
