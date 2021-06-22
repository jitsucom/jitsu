package redis

import (
	"fmt"
	"github.com/gomodule/redigo/redis"
)

const redisSetType = "set"

//setType is a Redis set key Type representation that executes SSCAN command
type setType struct {
	key string
}

func init() {
	registerKey(redisSetType, newSetType)
}

//newSetType returns setType
func newSetType(key string) key {
	return &setType{key: key}
}

//name returns key name
func (st *setType) name() string {
	return st.key
}

//get returns all values from set key
func (st *setType) get(conn redis.Conn) ([]map[string]interface{}, error) {
	cursor := 0
	result := []map[string]interface{}{}
	for {
		scannedResult, err := redis.Values(conn.Do("SSCAN", st.key, cursor, "COUNT", scanChunkSize))
		if err != nil {
			return nil, err
		}

		if len(scannedResult) != 2 {
			return nil, fmt.Errorf("error len of SSCAN result: %v", scannedResult)
		}

		cursor, _ := redis.Int(scannedResult[0], nil)
		values, _ := redis.Strings(scannedResult[1], nil)

		for _, value := range values {
			parsedValue, err := parseJSON(value)
			if err != nil {
				return nil, err
			}

			result = append(result, parsedValue...)
		}

		//end of cycle
		if cursor == 0 {
			break
		}
	}

	return result, nil
}
