package redis

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/gomodule/redigo/redis"
	"github.com/jitsucom/jitsu/server/drivers/base"
	"github.com/jitsucom/jitsu/server/jsonutils"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	"github.com/jitsucom/jitsu/server/schema"
	"strings"
	"time"
)

const (
	scanChunkSize    = 50000
	objectsChunkSize = 1000

	keyField   = "redis_key"
	valueField = "value"
)

//Redis is a Redis driver. It is used in syncing data from Redis.
type Redis struct {
	base.IntervalDriver

	collection     *base.Collection
	connectionPool *meta.RedisPool
	redisKey       string
}

func init() {
	//base.RegisterDriver(base.RedisType, NewRedis)
	//base.RegisterTestConnectionFunc(base.RedisType, TestRedis)
}

//NewRedis returns configured Redis driver instance
func NewRedis(_ context.Context, sourceConfig *base.SourceConfig, collection *base.Collection) (base.Driver, error) {
	config := &RedisConfig{}
	err := jsonutils.UnmarshalConfig(sourceConfig.Config, config)
	if err != nil {
		return nil, err
	}

	err = config.Validate()
	if err != nil {
		return nil, err
	}

	parameters := &RedisParameters{}
	if err := jsonutils.UnmarshalConfig(collection.Parameters, parameters); err != nil {
		return nil, err
	}
	if err := parameters.Validate(); err != nil {
		return nil, err
	}

	intPort, err := config.Port.Int64()
	if err != nil {
		return nil, fmt.Errorf("Error casting redis port [%s] to int: %v", config.Port.String(), err)
	}

	factory := meta.NewRedisPoolFactory(config.Host, int(intPort), config.Password, 0, config.TLSSkipVerify, config.SentinelMasterName)
	if defaultPort, ok := factory.CheckAndSetDefaultPort(); ok {
		logging.Warnf("[%s] port wasn't provided. Will be used default one: %d", sourceConfig.SourceID, defaultPort)
	}

	pool, err := factory.Create()
	if err != nil {
		return nil, err
	}

	return &Redis{
		IntervalDriver: base.IntervalDriver{SourceType: sourceConfig.Type},
		collection:     collection,
		connectionPool: pool,
		redisKey:       parameters.RedisKey,
	}, nil
}

//TestRedis tests connection to Redis without creating Driver instance
func TestRedis(sourceConfig *base.SourceConfig) error {
	config := &RedisConfig{}
	err := jsonutils.UnmarshalConfig(sourceConfig.Config, config)
	if err != nil {
		return err
	}
	err = config.Validate()
	if err != nil {
		return err
	}
	intPort, err := config.Port.Int64()
	if err != nil {
		return fmt.Errorf("Error casting redis port [%s] to int: %v", config.Port.String(), err)
	}

	factory := meta.NewRedisPoolFactory(config.Host, int(intPort), config.Password, 0, config.TLSSkipVerify, config.SentinelMasterName)
	factory.CheckAndSetDefaultPort()

	pool, err := factory.Create()
	if err != nil {
		return err
	}

	defer pool.Close()

	//test connection
	connection := pool.Get()
	defer connection.Close()

	_, err = redis.String(connection.Do("PING"))
	if err != nil {
		return err
	}

	return nil
}

func (r *Redis) GetRefreshWindow() (time.Duration, error) {
	return time.Hour * 24, nil
}

//GetAllAvailableIntervals returns ALL constant
func (r *Redis) GetAllAvailableIntervals() ([]*base.TimeInterval, error) {
	return []*base.TimeInterval{base.NewTimeInterval(schema.ALL, time.Time{})}, nil
}

//GetObjectsFor iterates over keys by mask and parses hash,string,list,set,zset types
//returns all parsed object or err if occurred
func (r *Redis) GetObjectsFor(interval *base.TimeInterval, objectsLoader base.ObjectsLoader) error {
	conn := r.connectionPool.Get()
	defer conn.Close()

	matchedKeys, err := r.scanKeys(conn, r.redisKey)
	if err != nil {
		return err
	}

	loaded := 0
	progress := 0
	var result []map[string]interface{}

	for i, redisKey := range matchedKeys {
		objects, err := redisKey.get(conn)
		if err != nil {
			return err
		}

		for _, object := range objects {
			object[keyField] = redisKey.name()
			result = append(result, object)
			if len(result) == objectsChunkSize {
				err = objectsLoader(result, loaded, -1, 100*progress/len(matchedKeys))
				if err != nil {
					return err
				}
				loaded += len(result)
				result = nil
				progress = i
			}
		}
	}
	if len(result) > 0 {
		err = objectsLoader(result, loaded, -1, 100*progress/len(matchedKeys))
		if err != nil {
			return err
		}
	}

	return nil
}

//Type returns Redis type
func (r *Redis) Type() string {
	return base.RedisType
}

//GetCollectionTable returns collection table
func (r *Redis) GetCollectionTable() string {
	return r.collection.GetTableName()
}

//GetCollectionMetaKey returns collection meta key (key is used in meta storage)
func (r *Redis) GetCollectionMetaKey() string {
	return r.collection.Name + "_" + r.GetCollectionTable()
}

//Close closes redis pool
func (r *Redis) Close() error {
	return r.connectionPool.Close()
}

//scanKeys returns keys that fit the keyMask
func (r *Redis) scanKeys(conn redis.Conn, keyMask string) ([]key, error) {
	//plain key
	if !strings.HasSuffix(keyMask, "*") {
		redisKey, err := r.exploreKey(conn, keyMask)
		if err != nil {
			return nil, err
		}

		return []key{redisKey}, nil
	}

	//by mask
	var redisKeys []key
	cursor := 0

	for {
		scannedResult, err := redis.Values(conn.Do("SCAN", cursor, "MATCH", keyMask, "COUNT", scanChunkSize))
		if err != nil {
			return nil, err
		}

		if len(scannedResult) != 2 {
			return nil, fmt.Errorf("error len of SCAN result: %v", scannedResult)
		}

		cursor, _ = redis.Int(scannedResult[0], nil)
		keyNames, _ := redis.Strings(scannedResult[1], nil)

		for _, keyName := range keyNames {
			redisKey, err := r.exploreKey(conn, keyName)
			if err != nil {
				return nil, err
			}

			redisKeys = append(redisKeys, redisKey)
		}

		//end of cycle
		if cursor == 0 {
			break
		}
	}

	return redisKeys, nil
}

//exploreKey returns key instance or err if unsupported key type
func (r *Redis) exploreKey(conn redis.Conn, key string) (key, error) {
	redisType, err := redis.String(conn.Do("TYPE", key))
	if err != nil {
		return nil, err
	}

	keyConstructor, ok := keyConstructors[redisType]
	if !ok {
		return nil, fmt.Errorf("unsupported redis key type to sync: %s", redisType)
	}

	return keyConstructor(key), nil
}

//parseJSON parses input string as
// 1. JSON object string - "{1: 2}"
// 2. JSON objects array string - "[{}, {}]"
// 3. JSON array string - "[1,2]"
// 4. plain string - "12"
func parseJSON(value string) ([]map[string]interface{}, error) {
	//JSON object string
	if strings.HasPrefix(value, "{") && strings.HasSuffix(value, "}") {
		object := map[string]interface{}{}
		err := json.Unmarshal([]byte(value), &object)
		if err != nil {
			return nil, err
		}

		return []map[string]interface{}{object}, nil
	}

	//JSON objects array string
	if strings.HasPrefix(value, "[{") && strings.HasSuffix(value, "}]") {
		var objectsIfaces []interface{}
		err := json.Unmarshal([]byte(value), &objectsIfaces)
		if err != nil {
			return nil, err
		}

		var result []map[string]interface{}
		for _, objectIface := range objectsIfaces {
			object, ok := objectIface.(map[string]interface{})
			if !ok {
				return nil, fmt.Errorf("error parsing JSON objects array - object: %v has type: %T", objectIface, objectIface)
			}

			result = append(result, object)
		}

		return result, nil
	}

	//JSON array string
	if strings.HasPrefix(value, "[") && strings.HasSuffix(value, "]") {
		var objects []interface{}
		err := json.Unmarshal([]byte(value), &objects)
		if err != nil {
			return nil, err
		}

		var result []map[string]interface{}
		for _, object := range objects {
			result = append(result, map[string]interface{}{valueField: object})
		}

		return result, nil
	}

	//plain string
	return []map[string]interface{}{{valueField: value}}, nil
}
