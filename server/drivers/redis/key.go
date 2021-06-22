package redis

import "github.com/gomodule/redigo/redis"

var keyConstructors = make(map[string]func(keyName string) key)

//key is a redis key type that gets value with underlying logic depends on key type
type key interface {
	get(conn redis.Conn) ([]map[string]interface{}, error)
	name() string
}

//registerKey registers function to create new redis key instance
func registerKey(keyType string, createKeyFunc func(keyName string) key) {
	keyConstructors[keyType] = createKeyFunc
}
