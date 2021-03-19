package statistics

import (
	"errors"
	"github.com/jitsucom/jitsu/server/logging"
	enstorages "github.com/jitsucom/jitsu/server/storages"
	"github.com/spf13/viper"
	"io"
	"time"
)

const (
	DayGranularity  = "day"
	HourGranularity = "hour"

	ErrParsingGranularityMsg = `[granularity] is a required query parameter and should have value 'day' or 'hour'`

	requestTimestampLayout  = "2006-01-02T15:04:05Z"
	responseTimestampLayout = "2006-01-02T15:04:05+0000"
)

type EventsPerTime struct {
	Key    string `json:"key"`
	Events int    `json:"events"`
}

type Storage interface {
	io.Closer
	GetEvents(projectId string, start, end time.Time, granularity string) ([]EventsPerTime, error)
}

func NewStorage(statisticsViper *viper.Viper, oldKeysByProject map[string][]string) (Storage, error) {
	if statisticsViper == nil {
		return &DummyStorage{}, nil
	}

	//statistics redis
	if statisticsViper.IsSet("redis") {
		redisConfig := &RedisConfig{}
		if err := statisticsViper.UnmarshalKey("redis", redisConfig); err != nil {
			return nil, err
		}
		if err := redisConfig.Validate(); err != nil {
			return nil, err
		}

		if redisConfig.Port == 0 {
			redisConfig.Port = 6379
		}

		logging.Info("Statistics storage: redis")
		return NewRedis(redisConfig)
	}

	//statistics postgres
	if statisticsViper.IsSet("postgres") {
		pgConfig := &enstorages.DestinationConfig{}
		if err := statisticsViper.UnmarshalKey("postgres", pgConfig); err != nil {
			return nil, err
		}
		if err := pgConfig.DataSource.Validate(); err != nil {
			return nil, err
		}

		logging.Info("Statistics storage: postgres")
		return NewPostgres(pgConfig.DataSource, oldKeysByProject)
	}

	//statistics prometheus
	if statisticsViper.IsSet("prometheus") {
		prometheusConfig := &PrometheusConfig{}
		if err := statisticsViper.UnmarshalKey("prometheus", prometheusConfig); err != nil {
			return nil, err
		}
		if err := prometheusConfig.Validate(); err != nil {
			return nil, err
		}

		logging.Info("Statistics storage: prometheus")
		return NewPrometheus(prometheusConfig)
	}

	return nil, errors.New("Unknown storage type. Supported: [prometheus, postgres]")
}

type DummyStorage struct {
}

func (ds *DummyStorage) GetEvents(projectId string, from, to time.Time, granularity string) ([]EventsPerTime, error) {
	return []EventsPerTime{}, nil
}

func (ds *DummyStorage) Close() error {
	return nil
}
