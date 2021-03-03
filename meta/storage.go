package meta

import (
	"github.com/spf13/viper"
	"io"
	"time"
)

const (
	StatusOk      = "OK"
	StatusFailed  = "FAILED"
	StatusLoading = "LOADING"

	DummyType = "Dummy"
	RedisType = "Redis"
)

type Storage interface {
	io.Closer

	//sources
	GetSignature(sourceId, collection, interval string) (string, error)
	SaveSignature(sourceId, collection, interval, signature string) error

	GetCollectionStatus(sourceId, collection string) (string, error)
	SaveCollectionStatus(sourceId, collection, status string) error
	GetCollectionLog(sourceId, collection string) (string, error)
	SaveCollectionLog(sourceId, collection, log string) error

	//events counters
	SuccessEvents(destinationId string, now time.Time, value int) error
	ErrorEvents(destinationId string, now time.Time, value int) error

	//events caching
	AddEvent(destinationId, eventId, payload string, now time.Time) (int, error)
	UpdateSucceedEvent(destinationId, eventId, success string) error
	UpdateErrorEvent(destinationId, eventId, error string) error
	RemoveLastEvent(destinationId string) error

	GetEvents(destinationId string, start, end time.Time, n int) ([]Event, error)
	GetTotalEvents(destinationId string) (int, error)

	//user recognition
	SaveAnonymousEvent(destinationId, anonymousId, eventId, payload string) error
	GetAnonymousEvents(destinationId, anonymousId string) (map[string]string, error)
	DeleteAnonymousEvent(destinationId, anonymousId, eventId string) error

	Type() string
}

func NewStorage(meta *viper.Viper) (Storage, error) {
	if meta == nil {
		return &Dummy{}, nil
	}

	host := meta.GetString("redis.host")
	port := meta.GetInt("redis.port")
	password := meta.GetString("redis.password")
	anonymousEventsTtl := meta.GetInt("redis.ttl_minutes.anonymous_events")

	if port == 0 {
		port = 6379
	}

	return NewRedis(host, port, password, anonymousEventsTtl)
}
