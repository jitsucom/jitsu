package redis

import (
	"github.com/gomodule/redigo/redis"
)

const redisStringType = "string"

//stringType is a Redis string key Type representation that executes GET command
type stringType struct {
	key string
}

func init() {
	registerKey(redisStringType, newStringType)
}

//newStringType returns stringType
func newStringType(key string) key {
	return &stringType{key: key}
}

//name returns key name
func (st *stringType) name() string {
	return st.key
}

//get returns value of string Redis key
func (st *stringType) get(conn redis.Conn) ([]map[string]interface{}, error) {
	value, err := redis.String(conn.Do("GET", st.key))
	if err != nil {
		return nil, err
	}

	return parseJSON(value)
}
