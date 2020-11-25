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

	//events caching
	SuccessEvent(destinationId string, now time.Time) error
	ErrorEvent(destinationId string, now time.Time) error

	AddEvent(destinationId, eventId, payload string, now time.Time) (int, error)
	UpdateEvent(destinationId, eventId, success, error string) error
	RemoveLastEvent(destinationId string) error

	GetEvents(destinationId string, start, end time.Time, n int) ([]Event, error)

	Type() string
}

func NewStorage(meta *viper.Viper) (Storage, error) {
	if meta == nil {
		return &Dummy{}, nil
	}

	host := meta.GetString("redis.host")
	port := meta.GetInt("redis.port")
	password := meta.GetString("redis.password")

	return NewRedis(host, port, password)
}
