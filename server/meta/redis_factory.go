package meta

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/FZambia/sentinel"
	"github.com/gomodule/redigo/redis"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/timestamp"
)

const (
	defaultRedisPort    = 6379
	defaultSentinelPort = 26379

	redisPrefix    = "redis://"
	redissPrefix   = "rediss://"
	sentinelPrefix = "sentinel://"
)

var (
	errMalformedURL = errors.New("Accepted format - sentinel://master_name:password@node1:port,node2:port")
)

// Options for Redis Pool
type Options struct {
	DefaultDialConnectTimeout time.Duration
	DefaultDialReadTimeout    time.Duration
	DefaultDialWriteTimeout   time.Duration

	MaxIdle     int
	MaxActive   int
	IdleTimeout time.Duration
	PingTimeout time.Duration
}

// DefaultOptions for Redis Pool
var DefaultOptions = Options{
	DefaultDialConnectTimeout: 10 * time.Second,
	DefaultDialReadTimeout:    10 * time.Second,
	DefaultDialWriteTimeout:   10 * time.Second,

	MaxIdle:     100,
	MaxActive:   600,
	IdleTimeout: 240 * time.Second,
	PingTimeout: 30 * time.Second,
}

//RedisPoolFactory is a factory for creating RedisPool
//supports creating RedisPool from URLs: redis://, rediss://, sentinel://
//and from config parameters like host,port, etc
type RedisPoolFactory struct {
	host               string
	port               int
	password           string
	sentinelMasterName string
	tlsSkipVerify      bool

	options Options
}

//NewRedisPoolFactory returns filled RedisPoolFactory and removes quotes in host
func NewRedisPoolFactory(host string, port int, password string, tlsSkipVerify bool, sentinelMasterMame string) *RedisPoolFactory {
	host = strings.TrimPrefix(host, `"`)
	host = strings.TrimPrefix(host, `'`)
	host = strings.TrimSuffix(host, `"`)
	host = strings.TrimSuffix(host, `'`)

	return &RedisPoolFactory{
		host:               host,
		port:               port,
		password:           password,
		tlsSkipVerify:      tlsSkipVerify,
		sentinelMasterName: sentinelMasterMame,
		options:            DefaultOptions,
	}
}

//WithOptions overrides options
func (rpf *RedisPoolFactory) WithOptions(options Options) *RedisPoolFactory {
	rpf.options = options
	return rpf
}

func (rpf *RedisPoolFactory) GetOptions() Options {
	return rpf.options
}

//Create returns configured RedisPool or err if ping failed
//host might be URLS:
//1. redis://:password@host:port
//2. rediss://:password@host:port
//3. sentinel://master_name:password@node1:port,node2:port
//4. plain host
func (rpf *RedisPoolFactory) Create() (*RedisPool, error) {
	redisSentinel, dialFunc, err := rpf.getSentinelAndDialFunc()
	if err != nil {
		return nil, err
	}

	poolToRedis := &redis.Pool{
		MaxIdle:     rpf.options.MaxIdle,
		MaxActive:   rpf.options.MaxActive,
		IdleTimeout: rpf.options.IdleTimeout,

		Wait: false,
		Dial: dialFunc,
		TestOnBorrow: func(c redis.Conn, t time.Time) error {
			if time.Since(t) < time.Minute {
				return nil
			}
			_, err := c.Do("PING")
			return err
		},
	}

	start := timestamp.Now()
	for timestamp.Now().Sub(start) <= rpf.options.PingTimeout {
		//test connection
		connection := poolToRedis.Get()
		_, err = redis.String(connection.Do("PING"))
		connection.Close()
		if err == nil {
			break
		}

		time.Sleep(time.Second)
		logging.Warnf("failed to ping Redis: %v", err)
	}

	if err != nil {
		_ = poolToRedis.Close()
		return nil, fmt.Errorf("testing Redis connection during %s: %v", rpf.options.PingTimeout, err)
	}

	return &RedisPool{
		pool:     poolToRedis,
		sentinel: redisSentinel,
	}, nil
}

func (rpf *RedisPoolFactory) getSentinelAndDialFunc() (*sentinel.Sentinel, func() (redis.Conn, error), error) {
	defaultDialConnectTimeout := redis.DialConnectTimeout(rpf.options.DefaultDialConnectTimeout)
	defaultDialReadTimeout := redis.DialReadTimeout(rpf.options.DefaultDialReadTimeout)
	defaultDialWriteTimeout := redis.DialWriteTimeout(rpf.options.DefaultDialWriteTimeout)

	options := []redis.DialOption{defaultDialConnectTimeout, defaultDialReadTimeout, defaultDialWriteTimeout}

	// 1. redis:// redis://
	if rpf.isURL() || rpf.isSecuredURL() {
		shouldSkipTls := rpf.tlsSkipVerify || rpf.isURL()
		options = append(options, redis.DialTLSSkipVerify(shouldSkipTls))
		dialFunc := newDialURLFunc(rpf.host, options)
		return nil, dialFunc, nil
	}

	// 2. sentinel://
	if rpf.isSentinelURL() {
		masterName, password, nodes, err := extractFromSentinelURL(rpf.host)
		if err != nil {
			return nil, nil, err
		}

		if password != "" {
			options = append(options, redis.DialPassword(password))
		}

		redisSentinel := &sentinel.Sentinel{
			Addrs:      nodes,
			MasterName: masterName,
			Dial: func(addr string) (redis.Conn, error) {
				c, err := redis.Dial(
					"tcp",
					addr, options...)
				if err != nil {
					return nil, err
				}
				return c, nil
			},
		}
		dialFunc := newSentinelDialFunc(redisSentinel, options)
		return redisSentinel, dialFunc, nil

	}

	if rpf.password != "" {
		options = append(options, redis.DialPassword(rpf.password))
	}

	//host, port with sentinel
	if rpf.sentinelMasterName != "" {
		var nodes []string
		if strings.Contains(rpf.host, ",") {
			nodes = strings.Split(rpf.host, ",")
		} else {
			nodes = []string{fmt.Sprintf("%s:%d", rpf.host, rpf.port)}
		}
		redisSentinel := &sentinel.Sentinel{
			Addrs:      nodes,
			MasterName: rpf.sentinelMasterName,
			Dial: func(addr string) (redis.Conn, error) {
				c, err := redis.Dial(
					"tcp",
					addr, options...)
				if err != nil {
					return nil, err
				}
				return c, nil
			},
		}
		dialFunc := newSentinelDialFunc(redisSentinel, options)
		return redisSentinel, dialFunc, nil
	}

	//host port
	dialFunc := newDialTcpFunc(rpf.host, rpf.port, options)
	return nil, dialFunc, nil
}

//CheckAndSetDefaultPort checks if port isn't set - put defaultRedisPort, if sentinel mode put defaultSentinelPort
func (rpf *RedisPoolFactory) CheckAndSetDefaultPort() (int, bool) {
	if rpf.port == 0 && !rpf.isURL() && !rpf.isSecuredURL() && !rpf.isSentinelURL() {
		if strings.Contains(rpf.host, ",") {
			//multiple sentinel
			return 0, false
		}

		parts := strings.Split(rpf.host, ":")
		if len(parts) == 2 {
			port, err := strconv.Atoi(parts[1])
			if err == nil {
				rpf.port = port
				rpf.host = parts[0]
				return rpf.port, false
			}
		}
		if rpf.sentinelMasterName != "" {
			rpf.port = defaultSentinelPort
		} else {
			rpf.port = defaultRedisPort
		}
		return rpf.port, true
	}

	return 0, false
}

//isURL returns true if RedisPoolFactory contains connection credentials via URL
func (rpf *RedisPoolFactory) isURL() bool {
	return strings.HasPrefix(rpf.host, redisPrefix)
}

//isSecuredURL returns true if RedisPoolFactory contains connection credentials via secured(SSL) URL
func (rpf *RedisPoolFactory) isSecuredURL() bool {
	return strings.HasPrefix(rpf.host, redissPrefix)
}

//isSentinelURL returns true if RedisPoolFactory contains connection credentials via sentinel URL
func (rpf *RedisPoolFactory) isSentinelURL() bool {
	return strings.HasPrefix(rpf.host, sentinelPrefix)
}

//Details returns host:port or host if host is a URL with sentinel information
func (rpf *RedisPoolFactory) Details() string {
	if rpf.isURL() || rpf.isSecuredURL() || rpf.isSentinelURL() {
		return rpf.host
	}

	connectionString := fmt.Sprintf("%s:%d", rpf.host, rpf.port)
	if rpf.sentinelMasterName != "" {
		if strings.Contains(rpf.host, ",") {
			connectionString = rpf.host
		}
		return fmt.Sprintf("%s with configured sentinel: %s", connectionString, rpf.sentinelMasterName)
	}

	return connectionString
}

func newDialTcpFunc(host string, port int, options []redis.DialOption) func() (redis.Conn, error) {
	return func() (redis.Conn, error) {
		return redis.Dial("tcp", fmt.Sprintf("%s:%d", host, port), options...)
	}
}

func newDialURLFunc(url string, options []redis.DialOption) func() (redis.Conn, error) {
	return func() (redis.Conn, error) {
		return redis.DialURL(url, options...)
	}
}

func newSentinelDialFunc(sntnl *sentinel.Sentinel, options []redis.DialOption) func() (redis.Conn, error) {
	return func() (redis.Conn, error) {
		masterAddr, err := sntnl.MasterAddr()
		if err != nil {
			return nil, err
		}
		err = sntnl.Discover()
		if err != nil {
			return nil, err
		}
		return redis.Dial("tcp", masterAddr, options...)
	}
}

//returns master name, password and nodes array
//url should be in format - sentinel://master_name:password@node1:port,node2:port
func extractFromSentinelURL(url string) (string, string, []string, error) {
	var masterName, password string
	var nodes []string

	sentinelURL := strings.Replace(url, sentinelPrefix, "", 1)
	parts := strings.Split(sentinelURL, "@")
	if len(parts) != 2 {
		return "", "", nil, errMalformedURL
	}

	masterNameWithPassword := parts[0]
	nodes = strings.Split(parts[1], ",")

	masterNameWithPasswordParts := strings.Split(masterNameWithPassword, ":")
	if len(masterNameWithPasswordParts) == 1 {
		masterName = masterNameWithPasswordParts[0]
	} else if len(masterNameWithPasswordParts) == 2 {
		masterName = masterNameWithPasswordParts[0]
		password = masterNameWithPasswordParts[1]
	} else {
		return "", "", nil, errMalformedURL
	}

	return masterName, password, nodes, nil
}
