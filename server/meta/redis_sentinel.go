package meta

import (
	"github.com/FZambia/sentinel"
	"github.com/gomodule/redigo/redis"
)

func newSentinelDialFunc(masterName string, sentinelsAddr []string, options []redis.DialOption) func() (redis.Conn, error) {
	sntnl := &sentinel.Sentinel{
		Addrs:      sentinelsAddr,
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
