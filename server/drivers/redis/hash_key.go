package redis

import (
	"fmt"
	"github.com/gomodule/redigo/redis"
)

const (
	hashField     = "redis_hash"
	redisHashType = "hash"
)

//hashType is a Redis hashtable key Type representation that executes HSCAN command
type hashType struct {
	key string
}

func init() {
	registerKey(redisHashType, newHashType)
}

//newHashType returns hashType
func newHashType(key string) key {
	return &hashType{key: key}
}

//name returns key name
func (ht *hashType) name() string {
	return ht.key
}

//get returns value of hash Redis key
func (ht *hashType) get(conn redis.Conn) ([]map[string]interface{}, error) {
	cursor := 0
	result := []map[string]interface{}{}
	for {
		scannedResult, err := redis.Values(conn.Do("HSCAN", ht.key, cursor, "COUNT", scanChunkSize))
		if err != nil {
			return nil, err
		}

		if len(scannedResult) != 2 {
			return nil, fmt.Errorf("error len of HSCAN result: %v", scannedResult)
		}

		cursor, _ := redis.Int(scannedResult[0], nil)
		values, _ := redis.StringMap(scannedResult[1], nil)

		for hash, value := range values {
			parsedValue, err := parseJSON(value)
			if err != nil {
				return nil, err
			}

			for _, object := range parsedValue {
				object[hashField] = hash
				result = append(result, object)
			}
		}

		//end of cycle
		if cursor == 0 {
			break
		}
	}

	return result, nil
}
