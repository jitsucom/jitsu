package redis

import "github.com/gomodule/redigo/redis"

const (
	redisListType = "list"
)

//listType is a Redis list key Type representation that executes LRANGE command
type listType struct {
	key string
}

func init() {
	registerKey(redisListType, newListType)
}

//newListType returns listType
func newListType(key string) key {
	return &listType{key: key}
}

//name returns key name
func (lt *listType) name() string {
	return lt.key
}

//get queries list size and gets values with chunks of scanChunkSize
//returns all values from list key
func (lt *listType) get(conn redis.Conn) ([]map[string]interface{}, error) {
	listLength, err := redis.Int(conn.Do("LLEN", lt.key))
	if err != nil {
		return nil, err
	}

	var result []map[string]interface{}

	start := 0
	for start < listLength {
		end := start + scanChunkSize

		values, err := redis.Strings(conn.Do("LRANGE", lt.key, start, end))
		if err != nil {
			return nil, err
		}

		for _, value := range values {
			parsedValue, err := parseJSON(value)
			if err != nil {
				return nil, err
			}

			result = append(result, parsedValue...)
		}

		start = end + 1
	}

	return result, nil
}
