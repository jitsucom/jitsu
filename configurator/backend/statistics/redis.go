package statistics

import (
	"errors"
	"fmt"
	"github.com/gomodule/redigo/redis"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/timestamp"
	"strconv"
	"time"
)

type RedisConfig struct {
	Host     string `mapstructure:"host"`
	Port     int    `mapstructure:"port"`
	Password string `mapstructure:"password"`
}

func (rc *RedisConfig) Validate() error {
	if rc == nil {
		return errors.New("redis config is required")
	}
	if rc.Host == "" {
		return errors.New("Redis host is required parameter")
	}
	return nil
}

type Redis struct {
	pool *redis.Pool
}

func NewRedis(config *RedisConfig) (*Redis, error) {
	logging.Infof("Initializing redis statistics storage [%s:%d]...", config.Host, config.Port)
	r := &Redis{pool: &redis.Pool{
		MaxIdle:     100,
		MaxActive:   600,
		IdleTimeout: 240 * time.Second,

		Wait: false,
		Dial: func() (redis.Conn, error) {
			c, err := redis.Dial(
				"tcp",
				config.Host+":"+strconv.Itoa(config.Port),
				redis.DialConnectTimeout(10*time.Second),
				redis.DialReadTimeout(10*time.Second),
				redis.DialPassword(config.Password),
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
	},
	}

	//test connection
	connection := r.pool.Get()
	defer connection.Close()
	_, err := redis.String(connection.Do("PING"))
	if err != nil {
		return nil, fmt.Errorf("Error testing connection to Redis: %v", err)
	}

	return r, nil
}

//GetEvents return events count by granularity
func (r *Redis) GetEvents(projectId string, start, end time.Time, granularity string) ([]EventsPerTime, error) {
	//get all source ids
	conn := r.pool.Get()
	defer conn.Close()

	key := "sources_index:project#" + projectId
	sourceIds, err := redis.Strings(conn.Do("SMEMBERS", key))
	if err != nil {
		if err == redis.ErrNil {
			return []EventsPerTime{}, nil
		}

		return nil, err
	}

	if granularity == HourGranularity {
		return r.getEventsPerHour(sourceIds, start, end)
	} else if granularity == DayGranularity {
		return r.getEventsPerDay(sourceIds, start, end)
	} else {
		return nil, fmt.Errorf("Unknown granulatiry: %s", granularity)
	}
}

func (r *Redis) getEventsPerHour(sourceIds []string, start, end time.Time) ([]EventsPerTime, error) {
	conn := r.pool.Get()
	defer conn.Close()

	eventsPerChunk := map[string]int{} //key = 2021-03-17T00:00:00+0000 | value = events count

	days := getCoveredDays(start, end)

	for _, day := range days {
		keyTime, _ := time.Parse(timestamp.DayLayout, day)

		for _, sourceId := range sourceIds {
			key := fmt.Sprintf("hourly_events:source#%s:day#%s:success", sourceId, day)

			perHour, err := redis.IntMap(conn.Do("HGETALL", key))
			if err != nil {
				if err == redis.ErrNil {
					continue
				}

				return nil, err
			}

			if perHour == nil {
				continue
			}

			for hourStr, value := range perHour {
				hour, _ := strconv.Atoi(hourStr)
				eventsPerChunk[keyTime.Add(time.Duration(hour)*time.Hour).Format(responseTimestampLayout)] += value
			}

		}
	}

	//build response
	eventsPerTime := []EventsPerTime{}

	startDayHour := time.Date(start.Year(), start.Month(), start.Day(), start.Hour(), 0, 0, 0, time.UTC)
	for startDayHour.Before(end) {
		key := startDayHour.Format(responseTimestampLayout)
		eventsCount, ok := eventsPerChunk[key]
		if ok {
			eventsPerTime = append(eventsPerTime, EventsPerTime{
				Key:    key,
				Events: eventsCount,
			})
		}

		startDayHour = startDayHour.Add(time.Hour)
	}

	return eventsPerTime, nil
}

func (r *Redis) getEventsPerDay(sourceIds []string, start, end time.Time) ([]EventsPerTime, error) {
	conn := r.pool.Get()
	defer conn.Close()

	eventsPerChunk := map[string]int{} //key = 2021-03-17T00:00:00+0000 | value = events count

	months := getCoveredMonths(start, end)

	for _, month := range months {
		keyTime, _ := time.Parse(timestamp.MonthLayout, month)

		for _, sourceId := range sourceIds {
			key := fmt.Sprintf("daily_events:source#%s:month#%s:success", sourceId, month)

			perDay, err := redis.IntMap(conn.Do("HGETALL", key))
			if err != nil {
				if err == redis.ErrNil {
					continue
				}

				return nil, err
			}

			if perDay == nil {
				continue
			}

			for dayStr, value := range perDay {
				day, _ := strconv.Atoi(dayStr)
				//add (day - 1) cause month date starts from first month's day
				eventsPerChunk[keyTime.AddDate(0, 0, day-1).Format(responseTimestampLayout)] += value
			}
		}
	}

	//build response
	eventsPerTime := []EventsPerTime{}

	startDay := time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, time.UTC)
	for startDay.Before(end) {
		key := startDay.Format(responseTimestampLayout)
		eventsCount, ok := eventsPerChunk[key]
		if ok {
			eventsPerTime = append(eventsPerTime, EventsPerTime{
				Key:    key,
				Events: eventsCount,
			})
		}

		startDay = startDay.AddDate(0, 0, 1)
	}

	return eventsPerTime, nil
}

func (r *Redis) Close() error {
	return r.pool.Close()
}

//getCoveredDays return array of YYYYMMDD day strings which are covered input interval
func getCoveredDays(start, end time.Time) []string {
	days := []string{start.Format(timestamp.DayLayout)}

	day := start.Day()
	for start.Before(end) {
		start = start.Add(time.Hour)
		nextDay := start.Day()
		if nextDay != day {
			days = append(days, start.Format(timestamp.DayLayout))
		}
		day = nextDay
	}

	return days
}

//getCoveredMonths return array of YYYYMM month strings which are covered input interval
func getCoveredMonths(start, end time.Time) []string {
	months := []string{start.Format(timestamp.MonthLayout)}

	month := start.Month()
	for start.Before(end) {
		start = start.Add(time.Hour * 24)
		nextMonth := start.Month()
		if nextMonth != month {
			months = append(months, start.Format(timestamp.MonthLayout))
		}
		month = nextMonth
	}

	return months
}
