package meta

import (
	"io"
	"time"

	"github.com/jitsucom/jitsu/server/logging"
	"github.com/spf13/viper"
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
	IncrementEventsCount(id, namespace, eventType, status string, now time.Time, value int64) error
	GetProjectSourceIDs(projectID string) ([]string, error)
	GetProjectDestinationIDs(projectID string) ([]string, error)
	//536-issue DEPRECATED instead of it all project sources will be selected
	GetProjectPushSourceIDs(projectID string) ([]string, error)
	GetEventsWithGranularity(namespace, status, eventType string, ids []string, start, end time.Time, granularity Granularity) ([]EventsPerTime, error)

	//** Cache **
	//events caching
	AddEvent(destinationID, eventID, payload string, now time.Time) error
	UpdateSucceedEvent(destinationID, eventID, success string) error
	UpdateErrorEvent(destinationID, eventID, error string) error
	UpdateSkipEvent(destinationID, eventID, error string) error
	TrimEvents(destinationID string, capacity int) error

	GetEvents(destinationID string, start, end time.Time, n int) ([]Event, error)
	GetTotalEvents(destinationID string) (int, error)

	// ** Sync Tasks **
	CreateTask(sourceID, collection string, task *Task, createdAt time.Time) error
	GetAllTasks(sourceID, collection string, start, end time.Time, limit int) ([]Task, error)
	GetLastTask(sourceID, collection string, offset int) (*Task, error)
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

func InitializeStorage(metaStorageConfiguration *viper.Viper) (Storage, error) {
	if metaStorageConfiguration == nil || metaStorageConfiguration.GetString("redis.host") == "" {
		return &Dummy{}, nil
	}

	host := metaStorageConfiguration.GetString("redis.host")
	port := metaStorageConfiguration.GetInt("redis.port")
	password := metaStorageConfiguration.GetString("redis.password")
	sentinelMaster := metaStorageConfiguration.GetString("redis.sentinel_master_name")
	tlsSkipVerify := metaStorageConfiguration.GetBool("redis.tls_skip_verify")
	factory := NewRedisPoolFactory(host, port, password, tlsSkipVerify, sentinelMaster)
	factory.CheckAndSetDefaultPort()

	logging.Infof("🏪 Initializing meta storage redis [%s]...", factory.Details())

	pool, err := factory.Create()
	if err != nil {
		logging.Fatalf("Error initializing meta storage: %v", err)
	}

	return NewRedis(pool), nil
}
