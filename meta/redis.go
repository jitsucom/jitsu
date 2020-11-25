package meta

import (
	"fmt"
	"github.com/gomodule/redigo/redis"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/metrics"
	"github.com/jitsucom/eventnative/timestamp"
	"strconv"
	"strings"
	"time"
)

type Redis struct {
	pool *redis.Pool
}

//redis key [variables] - description
//sources
//source#sourceId:collection#collectionId:chunks [sourceId, collectionId] - hashtable with signatures
//source#sourceId:collection#collectionId:status [sourceId, collectionId] - hashtable with collection statuses
//source#sourceId:collection#collectionId:log    [sourceId, collectionId] - hashtable with reloading logs
//
//events caching
//hourly_events:destination#destinationId:day#yyyymmdd:success [hour] - hashtable with success events counter by hour
//hourly_events:destination#destinationId:day#yyyymmdd:errors  [hour] - hashtable with error events counter by hour
//daily_events:destination#destinationId:month#yyyymm:success  [day] - hashtable with success events counter by day
//daily_events:destination#destinationId:month#yyyymm:errors   [day] - hashtable with error events counter by day
//
//last_events:destination#destinationId:id#eventn_ctx_event_id [original, success, error] - hashtable with original event json, processed with schema json, error json
//last_events_index:destination#destinationId [timestamp_long eventn_ctx_event_id] - sorted set of eventIds and timestamps
func NewRedis(host string, port int, password string) (*Redis, error) {
	r := &Redis{pool: &redis.Pool{
		MaxIdle:     100,
		MaxActive:   600,
		IdleTimeout: 240 * time.Second,

		Wait: false,
		Dial: func() (redis.Conn, error) {
			c, err := redis.Dial(
				"tcp",
				host+":"+strconv.Itoa(port),
				redis.DialConnectTimeout(10*time.Second),
				redis.DialReadTimeout(10*time.Second),
				redis.DialPassword(password),
			)
			if err != nil {
				return nil, err
			}
			return c, err
		},
		TestOnBorrow: func(c redis.Conn, t time.Time) error {
			_, err := c.Do("PING")
			return err
		},
	}}

	//test connection
	connection := r.pool.Get()
	defer connection.Close()
	_, err := redis.String(connection.Do("PING"))
	if err != nil {
		return nil, fmt.Errorf("Error testing connection to Redis: %v", err)
	}

	return r, nil
}

func (r *Redis) GetSignature(sourceId, collection, interval string) (string, error) {
	key := "source#" + sourceId + ":collection#" + collection + ":chunks"
	field := interval
	connection := r.pool.Get()
	defer connection.Close()
	signature, err := redis.String(connection.Do("HGET", key, field))
	noticeError(err)
	if err != nil {
		if err == redis.ErrNil {
			return "", nil
		}

		return "", err
	}

	return signature, nil
}

func (r *Redis) SaveSignature(sourceId, collection, interval, signature string) error {
	key := "source#" + sourceId + ":collection#" + collection + ":chunks"
	field := interval
	connection := r.pool.Get()
	defer connection.Close()
	_, err := connection.Do("HSET", key, field, signature)
	noticeError(err)
	if err != redis.ErrNil {
		return err
	}

	return nil
}

func (r *Redis) GetCollectionStatus(sourceId, collection string) (string, error) {
	key := "source#" + sourceId + ":collection#" + collection + ":status"
	field := "current"
	connection := r.pool.Get()
	defer connection.Close()
	status, err := redis.String(connection.Do("HGET", key, field))
	noticeError(err)
	if err != nil {
		if err == redis.ErrNil {
			return "", nil
		}

		return "", err
	}

	return status, nil
}

func (r *Redis) SaveCollectionStatus(sourceId, collection, status string) error {
	key := "source#" + sourceId + ":collection#" + collection + ":status"
	field := "current"
	connection := r.pool.Get()
	defer connection.Close()
	_, err := connection.Do("HSET", key, field, status)
	noticeError(err)
	if err != redis.ErrNil {
		return err
	}

	return nil
}

func (r *Redis) GetCollectionLog(sourceId, collection string) (string, error) {
	key := "source#" + sourceId + ":collection#" + collection + ":log"
	field := "current"
	connection := r.pool.Get()
	defer connection.Close()
	log, err := redis.String(connection.Do("HGET", key, field))
	noticeError(err)
	if err != nil {
		if err == redis.ErrNil {
			return "", nil
		}

		return "", err
	}

	return log, nil
}

func (r *Redis) SaveCollectionLog(sourceId, collection, log string) error {
	key := "source#" + sourceId + ":collection#" + collection + ":log"
	field := "current"
	connection := r.pool.Get()
	defer connection.Close()
	_, err := connection.Do("HSET", key, field, log)
	noticeError(err)
	if err != redis.ErrNil {
		return err
	}

	return nil
}

func (r *Redis) SuccessEvent(destinationId string, now time.Time) error {
	return r.incrementEventsCount(destinationId, "success", now)
}

func (r *Redis) ErrorEvent(destinationId string, now time.Time) error {
	return r.incrementEventsCount(destinationId, "errors", now)
}

func (r *Redis) AddEvent(destinationId, eventId, payload string, now time.Time) (int, error) {
	conn := r.pool.Get()
	//add event
	lastEventsKey := "last_events:destination#" + destinationId + ":id#" + eventId
	field := "original"
	err := conn.Send("HSET", lastEventsKey, field, payload)
	noticeError(err)
	if err != redis.ErrNil {
		return 0, err
	}

	//enrich index
	lastEventsIndexKey := "last_events_index:destination#" + destinationId
	err = conn.Send("ZADD", lastEventsIndexKey, field, now.Unix(), eventId)
	noticeError(err)
	if err != redis.ErrNil {
		return 0, err
	}

	//get index len
	err = conn.Send("ZCOUNT", lastEventsIndexKey, "-inf", "+inf")
	noticeError(err)
	if err != redis.ErrNil {
		return 0, err
	}

	err = conn.Flush()
	noticeError(err)
	if err != redis.ErrNil {
		return 0, err
	}

	return redis.Int(conn.Receive())
}

func (r *Redis) UpdateEvent(destinationId, eventId, success, error string) error {
	lastEventsKey := "last_events:destination#" + destinationId + ":id#" + eventId
	payload := []interface{}{lastEventsKey}
	if success != "" {
		payload = append(payload, "success", success)
	}

	if error != "" {
		payload = append(payload, "error", error)
	}

	_, err := r.pool.Get().Do("HMSET", payload...)
	noticeError(err)
	if err != redis.ErrNil {
		return err
	}

	return nil
}

func (r *Redis) RemoveLastEvent(destinationId string) error {
	conn := r.pool.Get()
	//remove last event from index
	lastEventsIndexKey := "last_events_index:destination#" + destinationId
	values, err := redis.Values(conn.Do("ZPOPMIN", lastEventsIndexKey))
	noticeError(err)
	if err != redis.ErrNil {
		return err
	}

	if len(values) != 2 {
		return fmt.Errorf("Error response format")
	}

	eventId, ok := values[0].(string)
	if !ok {
		return fmt.Errorf("Error eventId format")
	}

	lastEventsKey := "last_events:destination#" + destinationId + ":id#" + eventId
	_, err = conn.Do("HDEL", lastEventsKey)
	noticeError(err)
	if err != redis.ErrNil {
		return err
	}

	return nil
}

func (r *Redis) GetEvents(destinationId string, start, end time.Time, n int) ([]Event, error) {
	conn := r.pool.Get()

	//get index
	lastEventsIndexKey := "last_events_index:destination#" + destinationId
	eventIds, err := redis.Strings(conn.Do("ZRANGEBYSCORE", lastEventsIndexKey, start.Unix(), end.Unix(), "LIMIT", 0, n))
	noticeError(err)
	if err != redis.ErrNil {
		return nil, err
	}

	events := []Event{}
	for _, eventId := range eventIds {
		lastEventsKey := "last_events:destination#" + destinationId + ":id#" + eventId
		event, err := redis.Values(conn.Do("HGETALL", lastEventsKey))
		noticeError(err)
		if err != redis.ErrNil {
			return nil, err
		}

		if len(event) > 0 {
			eventObj := Event{}
			err := redis.ScanStruct(event, &eventObj)
			if err != nil {
				return nil, fmt.Errorf("Error deserializing event struct: %v", err)
			}

			events = append(events, eventObj)
		}
	}

	return events, nil
}

func (r *Redis) Type() string {
	return RedisType
}

func (r *Redis) Close() error {
	return r.pool.Close()
}

//increment success or errors keys depends on input status string
func (r *Redis) incrementEventsCount(destinationId, status string, now time.Time) error {
	conn := r.pool.Get()
	//increment hourly events
	dayKey := now.Format(timestamp.DayLayout)
	hourlyEventsKey := "hourly_events:destination#" + destinationId + ":day#" + dayKey + ":" + status
	fieldHour := strconv.Itoa(now.Hour())
	_, err := conn.Do("HINCRBY", hourlyEventsKey, fieldHour, 1)
	noticeError(err)
	if err != redis.ErrNil {
		return err
	}

	//increment daily events
	monthKey := now.Format(timestamp.MonthLayout)
	dailyEventsKey := "daily_events:destination#" + destinationId + ":month#" + monthKey + ":" + status
	fieldDay := strconv.Itoa(now.Day())
	_, err = conn.Do("HINCRBY", dailyEventsKey, fieldDay, 1)
	noticeError(err)
	if err != redis.ErrNil {
		return err
	}

	return nil
}

func noticeError(err error) {
	if err != nil {
		if err == redis.ErrPoolExhausted {
			metrics.RedisErrors("ERR_POOL_EXHAUSTED")
		} else if err == redis.ErrNil {
			metrics.RedisErrors("ERR_NIL")
		} else if strings.Contains(strings.ToLower(err.Error()), "timeout") {
			metrics.RedisErrors("ERR_TIMEOUT")
		} else {
			metrics.RedisErrors("UNKNOWN")
			logging.Error("Unknown redis error:", err)
		}
	}
}
