package meta

import (
	"github.com/spf13/viper"
	"io"
	"time"
)

const (
	DummyType = "Dummy"
	RedisType = "Redis"

	DayGranularity  = "day"
	HourGranularity = "hour"
)

type Storage interface {
	io.Closer

	//** Sources **
	//signatures
	GetSignature(sourceID, collection, interval string) (string, error)
	SaveSignature(sourceID, collection, interval, signature string) error

	//** Counters **
	//events counters
	SuccessEvents(id, namespace string, now time.Time, value int) error
	ErrorEvents(id, namespace string, now time.Time, value int) error
	SkipEvents(id, namespace string, now time.Time, value int) error
	GetProjectEventsWithGranularity(projectID string, start, end time.Time, granularity Granularity) ([]EventsPerTime, error)

	//** Cache **
	//events caching
	AddEvent(destinationID, eventID, payload string, now time.Time) (int, error)
	UpdateSucceedEvent(destinationID, eventID, success string) error
	UpdateErrorEvent(destinationID, eventID, error string) error
	RemoveLastEvent(destinationID string) error

	GetEvents(destinationID string, start, end time.Time, n int) ([]Event, error)
	GetTotalEvents(destinationID string) (int, error)

	//** Users recognition **
	SaveAnonymousEvent(destinationID, anonymousID, eventID, payload string) error
	GetAnonymousEvents(destinationID, anonymousID string) (map[string]string, error)
	DeleteAnonymousEvent(destinationID, anonymousID, eventID string) error

	//sync tasks
	CreateTask(sourceID, collection string, task *Task, createdAt time.Time) error
	UpsertTask(task *Task) error
	GetAllTasks(sourceID, collection string, start, end time.Time) ([]Task, error)
	GetLastTask(sourceID, collection string) (*Task, error)
	GetTask(taskID string) (*Task, error)

	//task logs
	AppendTaskLog(taskID string, now time.Time, message, level string) error
	GetTaskLogs(taskID string, start, end time.Time) ([]TaskLogRecord, error)

	//task queue
	PushTask(task *Task) error
	PollTask() (*Task, error)
	IsTaskInQueue(sourceID, collection string) (string, bool, error)

	Type() string
}

func NewStorage(meta *viper.Viper) (Storage, error) {
	if meta == nil {
		return &Dummy{}, nil
	}

	host := meta.GetString("redis.host")
	port := meta.GetInt("redis.port")
	password := meta.GetString("redis.password")
	anonymousEventsTTL := meta.GetInt("redis.ttl_minutes.anonymous_events")

	if port == 0 {
		port = 6379
	}

	return NewRedis(host, port, password, anonymousEventsTTL)
}
