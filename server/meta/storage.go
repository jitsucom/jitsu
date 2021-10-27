package meta

import (
	"github.com/spf13/viper"
	"io"
	"time"
)

const (
	DummyType = "Dummy"
	RedisType = "Redis"
)

type Storage interface {
	io.Closer

	//** Sources **
	//signatures
	GetSignature(sourceID, collection, interval string) (string, error)
	SaveSignature(sourceID, collection, interval, signature string) error
	DeleteSignature(sourceID, collection string) error

	//** Counters **
	//events counters
	SuccessEvents(id, namespace string, now time.Time, value int) error
	ErrorEvents(id, namespace string, now time.Time, value int) error
	SkipEvents(id, namespace string, now time.Time, value int) error
	GetProjectSourceIDs(projectID string) ([]string, error)
	GetProjectPushSourceIDs(projectID string) ([]string, error)
	GetProjectDestinationIDs(projectID string) ([]string, error)
	GetEventsWithGranularity(namespace, status string, ids []string, start, end time.Time, granularity Granularity) ([]EventsPerTime, error)

	//** Cache **
	//events caching
	AddEvent(destinationID, eventID, payload string, now time.Time) (int, error)
	UpdateSucceedEvent(destinationID, eventID, success string) error
	UpdateErrorEvent(destinationID, eventID, error string) error
	UpdateSkipEvent(destinationID, eventID, error string) error
	RemoveLastEvent(destinationID string) error

	GetEvents(destinationID string, start, end time.Time, n int) ([]Event, error)
	GetTotalEvents(destinationID string) (int, error)

	//** Users recognition **
	SaveAnonymousEvent(destinationID, anonymousID, eventID, payload string) error
	GetAnonymousEvents(destinationID, anonymousID string) (map[string]string, error)
	DeleteAnonymousEvent(destinationID, anonymousID, eventID string) error

	// ** Sync Tasks **
	CreateTask(sourceID, collection string, task *Task, createdAt time.Time) error
	GetAllTasks(sourceID, collection string, start, end time.Time, limit int) ([]Task, error)
	GetLastTask(sourceID, collection string) (*Task, error)
	GetTask(taskID string) (*Task, error)
	GetAllTaskIDs(sourceID, collection string, descendingOrder bool) ([]string, error)
	RemoveTasks(sourceID, collection string, taskIDs ...string) (int, error)
	UpdateStartedTask(taskID, status string) error
	UpdateFinishedTask(taskID, status string) error

	//heartbeat
	TaskHeartBeat(taskID string) error
	RemoveTaskFromHeartBeat(taskID string) error
	GetAllTasksHeartBeat() (map[string]string, error)
	GetAllTasksForInitialHeartbeat(runningStatus, scheduledStatus string, lastActivityThreshold time.Duration) ([]string, error)

	//task logs
	AppendTaskLog(taskID string, now time.Time, system, message, level string) error
	GetTaskLogs(taskID string, start, end time.Time) ([]TaskLogRecord, error)

	//task queue
	PushTask(task *Task) error
	PollTask() (*Task, error)

	//system
	GetOrCreateClusterID(generatedClusterID string) string

	Type() string
}

func NewStorage(meta *viper.Viper) (Storage, error) {
	if meta == nil {
		return &Dummy{}, nil
	}

	host := meta.GetString("redis.host")
	port := meta.GetInt("redis.port")
	password := meta.GetString("redis.password")
	sentinelMaster := meta.GetString("redis.sentinel_master_name")
	anonymousEventsTTL := meta.GetInt("redis.ttl_minutes.anonymous_events")
	tlsSkipVerify := meta.GetBool("redis.tls_skip_verify")

	factory := NewRedisPoolFactory(host, port, password, tlsSkipVerify, sentinelMaster)
	factory.CheckAndSetDefaultPort()

	return NewRedis(factory, anonymousEventsTTL)
}
