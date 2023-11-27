package users

import (
	"github.com/gomodule/redigo/redis"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	"github.com/jitsucom/jitsu/server/metrics"
)

//** Retroactive user recognition **
//anonymous_events:token_id#${tokenID}:anonymous_id#${cookies_anonymous_id} [event_id] {event JSON} - hashtable with all anonymous events

type Redis struct {
	pool                      *meta.RedisPool
	anonymousEventsSecondsTTL int
	errorMetrics              *meta.ErrorMetrics
}

func NewRedis(pool *meta.RedisPool, anonymousEventsMinutesTTL int) *Redis {
	return &Redis{
		pool:                      pool,
		anonymousEventsSecondsTTL: anonymousEventsMinutesTTL * 60,
		errorMetrics:              meta.NewErrorMetrics(metrics.UserRecognitionRedisErrors),
	}
}

//SaveAnonymousEvent saves event JSON by tokenID and user anonymous ID key
func (r *Redis) SaveAnonymousEvent(tokenID, anonymousID, eventID, payload string) error {
	conn := r.pool.Get()
	defer conn.Close()
	//add event
	anonymousEventKey := "anonymous_events:token_id#" + tokenID + ":anonymous_id#" + anonymousID
	_, err := conn.Do("HSET", anonymousEventKey, eventID, payload)
	if err != nil && err != redis.ErrNil {
		r.errorMetrics.NoticeError(err)
		return err
	}

	if r.anonymousEventsSecondsTTL > 0 {
		_, err := conn.Do("EXPIRE", anonymousEventKey, r.anonymousEventsSecondsTTL)
		if err != nil && err != redis.ErrNil {
			r.errorMetrics.NoticeError(err)
			logging.SystemErrorf("Error EXPIRE anonymous event %s %s: %v", anonymousEventKey, eventID, err)
		}
	}

	return nil
}

//GetAnonymousEvents returns events JSON per event ID map
func (r *Redis) GetAnonymousEvents(tokenID, anonymousID string) (map[string]string, error) {
	conn := r.pool.Get()
	defer conn.Close()
	//get events
	anonymousEventKey := "anonymous_events:token_id#" + tokenID + ":anonymous_id#" + anonymousID

	eventsMap, err := redis.StringMap(conn.Do("HGETALL", anonymousEventKey))
	if err != nil && err != redis.ErrNil {
		r.errorMetrics.NoticeError(err)
		return nil, err
	}

	return eventsMap, nil
}

//DeleteAnonymousEvent deletes event with eventID
func (r *Redis) DeleteAnonymousEvent(tokenID, anonymousID string, eventID ...string) error {
	conn := r.pool.Get()
	defer conn.Close()

	//remove event
	anonymousEventKey := "anonymous_events:token_id#" + tokenID + ":anonymous_id#" + anonymousID
	args := make([]interface{}, len(eventID)+1)
	args[0] = anonymousEventKey
	for i, id := range eventID {
		args[i+1] = id
	}
	_, err := conn.Do("HDEL", args...)
	if err != nil && err != redis.ErrNil {
		r.errorMetrics.NoticeError(err)
		return err
	}

	return nil
}

func (r *Redis) Type() string {
	return RedisStorageType
}

func (r *Redis) Close() error {
	return r.pool.Close()
}
