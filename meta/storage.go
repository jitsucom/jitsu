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

	//** Sources **
	//signatures
	GetSignature(sourceId, collection, interval string) (string, error)
	SaveSignature(sourceId, collection, interval, signature string) error

	//** Counters **
	//events counters
	SuccessEvents(id, namespace string, now time.Time, value int) error
	ErrorEvents(id, namespace string, now time.Time, value int) error
	SkipEvents(id, namespace string, now time.Time, value int) error

	//** Cache **
	//events caching
	AddEvent(destinationId, eventId, payload string, now time.Time) (int, error)
	UpdateSucceedEvent(destinationId, eventId, success string) error
	UpdateErrorEvent(destinationId, eventId, error string) error
	RemoveLastEvent(destinationId string) error

	GetEvents(destinationId string, start, end time.Time, n int) ([]Event, error)
	GetTotalEvents(destinationId string) (int, error)

	//** Users recognition **
	SaveAnonymousEvent(destinationId, anonymousId, eventId, payload string) error
	GetAnonymousEvents(destinationId, anonymousId string) (map[string]string, error)
	DeleteAnonymousEvent(destinationId, anonymousId, eventId string) error

	//sync tasks
	CreateTask(sourceId, collection string, task *Task, createdAt time.Time) error
	UpsertTask(task *Task) error
	GetAllTasks(sourceId, collection string, start, end time.Time) ([]Task, error)
	GetLastTask(sourceId, collection string) (*Task, error)
	GetTask(taskId string) (*Task, error)

	//task logs
	AppendTaskLog(taskId string, now time.Time, message, level string) error
	GetTaskLogs(taskId string, start, end time.Time) ([]TaskLogRecord, error)

	//task queue
	PushTask(task *Task) error
	PollTask() (*Task, error)
	IsTaskInQueue(sourceId, collection string) (string, bool, error)

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
