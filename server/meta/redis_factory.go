package meta

import (
	"errors"
	"fmt"
	"github.com/FZambia/sentinel"
	"github.com/gomodule/redigo/redis"
	"strconv"
	"strings"
	"time"
)

const (
	defaultRedisPort    = 6379
	defaultSentinelPort = 26379

	redisPrefix    = "redis://"
	redissPrefix   = "rediss://"
	sentinelPrefix = "sentinel://"
)

var (
	defaultDialConnectTimeout = redis.DialConnectTimeout(10 * time.Second)
	defaultDialReadTimeout    = redis.DialReadTimeout(10 * time.Second)

	errMalformedURL = errors.New("Accepted format - sentinel://master_name:password@node1:port,node2:port")
)

//RedisPoolFactory is a factory for creating RedisPool
//supports creating RedisPool from URLs: redis://, rediss://, sentinel://
//and from config parameters like host,port, etc
type RedisPoolFactory struct {
	host               string
	port               int
	password           string
	sentinelMasterName string
	tlsSkipVerify      bool
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
	}
}

//Create returns configured RedisPool or err if ping failed
//host might be URLS:
//1. redis://:password@host:port
//2. rediss://:password@host:port
//3. sentinel://master_name:password@node1:port,node2:port
//4. plain host
func (rpf *RedisPoolFactory) Create() (*RedisPool, error) {
	var dialFunc func() (redis.Conn, error)
	var redisSentinel *sentinel.Sentinel
	options := []redis.DialOption{defaultDialConnectTimeout, defaultDialReadTimeout}

	if rpf.isURL() || rpf.isSecuredURL() {
		shouldSkipTls := rpf.tlsSkipVerify || rpf.isURL()
		options = append(options, redis.DialTLSSkipVerify(shouldSkipTls))
		dialFunc = newDialURLFunc(rpf.host, options)
	} else if rpf.isSentinelURL() {
		masterName, password, nodes, err := extractFromSentinelURL(rpf.host)
		if err != nil {
			return nil, err
		}

		if password != "" {
			options = append(options, redis.DialPassword(password))
		}

		redisSentinel = &sentinel.Sentinel{
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
		dialFunc = newSentinelDialFunc(redisSentinel, options)
	} else {
		if rpf.password != "" {
			options = append(options, redis.DialPassword(rpf.password))
		}

		if rpf.sentinelMasterName != "" {
			var nodes []string
			if strings.Contains(rpf.host, ",") {
				nodes = strings.Split(rpf.host, ",")
			} else {
				nodes = []string{fmt.Sprintf("%s:%d", rpf.host, rpf.port)}
			}
			redisSentinel = &sentinel.Sentinel{
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
			dialFunc = newSentinelDialFunc(redisSentinel, options)
		} else {
			dialFunc = newDialTcpFunc(rpf.host, rpf.port, options)
		}
	}

	poolToRedis := &redis.Pool{
		MaxIdle:     100,
		MaxActive:   600,
		IdleTimeout: 240 * time.Second,

		Wait: false,
		Dial: dialFunc,
		TestOnBorrow: func(c redis.Conn, t time.Time) error {
			_, err := c.Do("PING")
			return err
		},
	}

	//test connection
	connection := poolToRedis.Get()
	defer connection.Close()

	if _, err := redis.String(connection.Do("PING")); err != nil {
		poolToRedis.Close()
		return nil, fmt.Errorf("testing Redis connection: %v", err)
	}

	return &RedisPool{
		pool:     poolToRedis,
		sentinel: redisSentinel,
	}, nil
}

//CheckAndSetDefaultPort checks if port isn't set - put defaultRedisPort, if sentinel mode put defaultSentinelPort
func (rpf *RedisPoolFactory) CheckAndSetDefaultPort() (int, bool) {
	if rpf.port == 0 && !rpf.isURL() && !rpf.isSecuredURL() && !rpf.isSentinelURL() {
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
		return fmt.Sprintf("%s with configured sentinel: %s", connectionString, rpf.sentinelMasterName)
	}

	return connectionString
}

func newDialTcpFunc(host string, port int, options []redis.DialOption) func() (redis.Conn, error) {
	return func() (redis.Conn, error) {
		c, err := redis.Dial("tcp", fmt.Sprintf("%s:%d", host, port), options...)
		if err != nil {
			return nil, err
		}
		return c, err
	}
}

func newDialURLFunc(url string, options []redis.DialOption) func() (redis.Conn, error) {
	return func() (redis.Conn, error) {
		c, err := redis.DialURL(url, options...)
		if err != nil {
			return nil, err
		}
		return c, err
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
		c, err := redis.Dial("tcp", masterAddr, options...)
		if err != nil {
			return nil, err
		}
		return c, nil
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
