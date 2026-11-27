package app

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"github.com/gomodule/redigo/redis"
	"github.com/jitsucom/bulker/bulkerapp/metrics"
	"github.com/jitsucom/bulker/jitsubase/appbase"
	"github.com/jitsucom/bulker/jitsubase/safego"
	"github.com/jitsucom/bulker/jitsubase/utils"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

const redisDestinationsKey = "enrichedConnections"
const redisConfigurationSourceServiceName = "redis_configuration"

var redisDatabaseNumberRegexp = regexp.MustCompile(`/(\d{1,2})$`)

type RedisConfigurationSource struct {
	appbase.Service
	sync.Mutex
	currentHash uint64
	refreshChan chan bool
	changesChan chan bool

	redisPool    *redis.Pool
	database     int
	config       map[string]any
	destinations map[string]*DestinationConfig
}

func NewRedisConfigurationSource(appconfig *Config) (*RedisConfigurationSource, error) {
	base := appbase.NewServiceBase(redisConfigurationSourceServiceName)
	base.Debugf("Creating RedisConfigurationSource with redisURL: %s", appconfig.ConfigSource)
	redisDbStr := redisDatabaseNumberRegexp.FindStringSubmatch(appconfig.ConfigSource)
	redisDbNumber := 0
	if len(redisDbStr) == 2 {
		redisDbNumber, _ = strconv.Atoi(redisDbStr[1])
	}
	redisPool := newPool(appconfig.ConfigSource, appconfig.RedisTLSCA)
	r := RedisConfigurationSource{
		Service:      base,
		redisPool:    redisPool,
		database:     redisDbNumber,
		refreshChan:  make(chan bool, 1),
		changesChan:  make(chan bool, 1),
		config:       make(map[string]any),
		destinations: make(map[string]*DestinationConfig),
	}
	err := r.init()
	if err != nil {
		return nil, err
	}
	return &r, nil
}

func (rcs *RedisConfigurationSource) init() error {
	conn := rcs.redisPool.Get()
	defer conn.Close()
	_, err := conn.Do("CONFIG", "SET", "notify-keyspace-events", "Kg")
	if err != nil {
		rcs.Warnf("failed to set 'notify-keyspace-events' config setting: %v", err)
	}
	err = rcs.load(false)
	if err != nil {
		return rcs.NewError("failed to load initial config: %v", err)
	}
	safego.RunWithRestart(rcs.pubsub)
	safego.RunWithRestart(rcs.refresh)

	return nil
}

func (rcs *RedisConfigurationSource) pubsub() {
	redisPubSubChannel := fmt.Sprintf("__keyspace@%d__:%s", rcs.database, redisDestinationsKey)
	for {
		select {
		case refresh := <-rcs.refreshChan:
			if !refresh {
				//closed channel. exiting goroutine
				rcs.Infof("Closed Redis Pub/Sub channel: %s", redisPubSubChannel)
				return
			}
		default:
		}
		rcs.Infof("Starting Redis Pub/Sub channel: %s", redisPubSubChannel)
		pubSubConn := rcs.redisPool.Get()
		// Subscribe to the channel
		psc := redis.PubSubConn{Conn: pubSubConn}
		err := psc.Subscribe(redisPubSubChannel)
		if err != nil {
			_ = psc.Unsubscribe(redisPubSubChannel)
			_ = pubSubConn.Close()
			rcs.Errorf("Failed to subscribe to Redis Pub/Sub channel %s: %v", redisPubSubChannel, err)
			time.Sleep(10 * time.Second)
			continue
		}
	loop:
		for {
			switch v := psc.Receive().(type) {
			case redis.Message:
				rcs.Infof("%s: message: %s", v.Channel, v.Data)
				rcs.refreshChan <- true
			case redis.Subscription:
				rcs.Infof("%s: %s %d", v.Channel, v.Kind, v.Count)
				if v.Kind == "subscribe" {
					rcs.refreshChan <- true
				}
			case error:
				rcs.Errorf("Redis PubSub error.: %v", v)
				break loop
			}
		}
		_ = psc.Unsubscribe(redisPubSubChannel)
		_ = pubSubConn.Close()

	}
}

func (rcs *RedisConfigurationSource) refresh() {
	for range rcs.refreshChan {
		err := rcs.load(true)
		if err != nil {
			rcs.Errorf("Failed to refresh RedisConfigurationSource: %v", err)
		}
	}
}

func (rcs *RedisConfigurationSource) load(notify bool) error {
	rcs.Debugf("Loading RedisConfigurationSource")
	conn := rcs.redisPool.Get()
	defer conn.Close()
	configsById, err := redis.StringMap(conn.Do("HGETALL", redisDestinationsKey))
	if err != nil {
		metrics.ConfigurationSourceError(RedisError(err)).Inc()
		return rcs.NewError("failed to load destinations by key: %s : %v", redisDestinationsKey, err)
	}
	newHash, err := utils.HashAny(configsById)
	if err != nil {
		metrics.ConfigurationSourceError("hash_error").Inc()
		return rcs.NewError("failed generate hash of redis config: %v", err)
	}
	if newHash == rcs.currentHash {
		rcs.Infof("RedisConfigurationSource: no changes")
		return nil
	}
	newDsts := make(map[string]*DestinationConfig, len(configsById))
	for id, config := range configsById {
		dstCfg := DestinationConfig{}
		err := utils.ParseObject(config, &dstCfg)
		if err != nil {
			metrics.ConfigurationSourceError("parse_error").Inc()
			// the config holds the destination's credentials: the error says what is wrong with it, the text is not logged
			rcs.Errorf("failed to parse config for destination %s: %v", id, err)
		} else if dstCfg.UsesBulker {
			dstCfg.Config.Id = id
			rcs.Debugf("parsed config for destination %s (type %s)", id, dstCfg.Config.BulkerType)
			newDsts[id] = &dstCfg
		}
	}
	rcs.Lock()
	rcs.destinations = newDsts
	rcs.currentHash = newHash
	rcs.Unlock()
	if notify {
		select {
		case rcs.changesChan <- true:
			rcs.Infof("RedisConfigurationSource: changes detected")
			//notify listener if it is listening
		default:
		}
	}
	return nil
}

func newPool(redisURL string, ca string) *redis.Pool {
	opts := make([]redis.DialOption, 0)
	if ca != "" || strings.HasPrefix(redisURL, "rediss://") {
		tlsConfig := tls.Config{InsecureSkipVerify: true}
		if ca != "" {
			rootCAs, _ := x509.SystemCertPool()
			if rootCAs == nil {
				rootCAs = x509.NewCertPool()
			}
			rootCAs.AppendCertsFromPEM([]byte(ca))
			tlsConfig.RootCAs = rootCAs
		}
		opts = append(opts, redis.DialUseTLS(true), redis.DialTLSConfig(&tlsConfig))
	}

	return &redis.Pool{
		MaxIdle:     3,
		IdleTimeout: 240 * time.Second,
		// Dial or DialContext must be set. When both are set, DialContext takes precedence over Dial.
		Dial: func() (redis.Conn, error) { return redis.DialURL(redisURL, opts...) },
	}
}

func (rcs *RedisConfigurationSource) GetDestinationConfig(id string) *DestinationConfig {
	rcs.Lock()
	defer rcs.Unlock()
	return rcs.destinations[id]
}

func (rcs *RedisConfigurationSource) GetValue(key string) any {
	rcs.Lock()
	defer rcs.Unlock()
	return rcs.config[key]
}

func (rcs *RedisConfigurationSource) GetDestinationConfigs() []*DestinationConfig {
	rcs.Lock()
	defer rcs.Unlock()
	dstConfigs := make([]*DestinationConfig, 0, len(rcs.destinations))
	for _, dstCfg := range rcs.destinations {
		dstConfigs = append(dstConfigs, dstCfg)
	}
	return dstConfigs
}

func (rcs *RedisConfigurationSource) Close() error {
	close(rcs.refreshChan)
	close(rcs.changesChan)
	return rcs.redisPool.Close()
}

func (rcs *RedisConfigurationSource) ChangesChannel() <-chan bool {
	return rcs.changesChan
}

func RedisError(err error) string {
	if err == nil {
		return ""
	}
	if err == redis.ErrPoolExhausted {
		return "redis error: ERR_POOL_EXHAUSTED"
	} else if err == redis.ErrNil {
		return "redis error: ERR_NIL"
	} else if strings.Contains(strings.ToLower(err.Error()), "timeout") {
		return "redis error: ERR_TIMEOUT"
	} else {
		return "redis error: UNKNOWN"
	}
}
