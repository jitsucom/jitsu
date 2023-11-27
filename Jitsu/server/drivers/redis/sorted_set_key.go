package redis

import (
	"fmt"
	"github.com/gomodule/redigo/redis"
)

const (
	redisSortedSetType = "zset"

	scoreField = "redis_score"
)

//sortedSetType is a Redis sorted set key Type representation that executes ZSCAN command
type sortedSetType struct {
	key string
}

func init() {
	registerKey(redisSortedSetType, newSortedSetType)
}

//newSortedSetType returns sortedSetType
func newSortedSetType(key string) key {
	return &sortedSetType{key: key}
}

//name returns key name
func (sst *sortedSetType) name() string {
	return sst.key
}

//get returns all values from sorted set key
func (sst *sortedSetType) get(conn redis.Conn) ([]map[string]interface{}, error) {
	cursor := 0
	result := []map[string]interface{}{}
	for {
		scannedResult, err := redis.Values(conn.Do("ZSCAN", sst.key, cursor, "COUNT", scanChunkSize))
		if err != nil {
			return nil, err
		}

		if len(scannedResult) != 2 {
			return nil, fmt.Errorf("error len of ZSCAN result: %v", scannedResult)
		}

		cursor, _ := redis.Int(scannedResult[0], nil)
		valueScores, _ := redis.StringMap(scannedResult[1], nil)

		for value, score := range valueScores {
			parsedValue, err := parseJSON(value)
			if err != nil {
				return nil, err
			}

			for _, object := range parsedValue {
				object[scoreField] = score
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
