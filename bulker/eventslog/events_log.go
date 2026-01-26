package eventslog

import (
	"fmt"
	"github.com/jitsucom/bulker/jitsubase/utils"
	"io"
	"strconv"
	"strings"
	"time"
)

type EventType string
type EventStatus string
type EventsLogRecordId string
type Level string

const (
	LevelInfo    Level = "info"
	LevelWarning Level = "warn"
	LevelError   Level = "error"
	LevelDebug   Level = "debug"
)

const (
	EventTypeIncoming  EventType = "incoming"
	EventTypeProcessed EventType = "bulker_stream"
	EventTypeBatch     EventType = "bulker_batch"
	EventTypeFunction  EventType = "function"
)

type EventsLogFilter struct {
	Start    time.Time
	End      time.Time
	BeforeId EventsLogRecordId
	Filter   func(event any) bool
}

type EventsLogRecord struct {
	Id      EventsLogRecordId `json:"id"`
	Date    time.Time         `json:"date"`
	Content any               `json:"content"`
}

type ActorEvent struct {
	EventType EventType
	Level     Level
	ActorId   string
	Event     any
	Timestamp time.Time
}

type EventsLogService interface {
	io.Closer
	// PostEvent posts event to the events log
	// actorId – id of entity of event origin. E.g. for 'incoming' event - id of site, for 'processed' event - id of destination
	PostEvent(event *ActorEvent) (id EventsLogRecordId, err error)

	PostAsync(event *ActorEvent)

	GetEvents(eventType EventType, actorId string, level string, filter *EventsLogFilter, limit int) ([]EventsLogRecord, error)

	InsertTaskLog(level, logger, message, syncId, taskId string, timestamp time.Time) error

	Id() string
}

type MultiEventsLogService struct {
	Services []EventsLogService
}

func (m *MultiEventsLogService) Id() string {
	return strings.Join(utils.ArrayMap(m.Services, func(service EventsLogService) string {
		return service.Id()
	}), ",")
}

func (m *MultiEventsLogService) PostEvent(event *ActorEvent) (id EventsLogRecordId, err error) {
	for _, service := range m.Services {
		id, err = service.PostEvent(event)
		if err != nil {
			return
		}
	}
	return
}

func (m *MultiEventsLogService) PostAsync(event *ActorEvent) {
	for _, service := range m.Services {
		service.PostAsync(event)
	}
}

func (m *MultiEventsLogService) InsertTaskLog(level, logger, message, syncId, taskId string, timestamp time.Time) error {
	for _, service := range m.Services {
		err := service.InsertTaskLog(level, logger, message, syncId, taskId, timestamp)
		if err != nil {
			return err
		}
	}
	return nil
}

func (m *MultiEventsLogService) GetEvents(eventType EventType, actorId string, level string, filter *EventsLogFilter, limit int) ([]EventsLogRecord, error) {
	for _, service := range m.Services {
		events, _ := service.GetEvents(eventType, actorId, level, filter, limit)
		if len(events) > 0 {
			return events, nil
		}
	}
	return nil, nil
}

func (m *MultiEventsLogService) Close() error {
	for _, service := range m.Services {
		_ = service.Close()
	}
	return nil
}

// GetStartAndEndIds returns end and start ids for the stream
func (f *EventsLogFilter) GetStartAndEndIds() (start, end string, err error) {
	end = "+"
	start = "-"
	if f == nil {
		return
	}
	var endTime int64
	if f.BeforeId != "" {
		end = fmt.Sprintf("(%s", f.BeforeId)
		tsTime, err := parseTimestamp(string(f.BeforeId))
		if err != nil {
			return "", "", err
		}
		endTime = tsTime.UnixMilli()
	}
	if !f.End.IsZero() {
		if endTime == 0 || f.End.UnixMilli() < endTime {
			end = fmt.Sprint(f.End.UnixMilli())
		}
	}
	if !f.Start.IsZero() {
		start = fmt.Sprint(f.Start.UnixMilli())
	}

	return
}

func parseTimestamp(id string) (time.Time, error) {
	match := redisStreamIdTimestampPart.FindStringSubmatch(id)
	if match == nil {
		return time.Time{}, fmt.Errorf("failed to parse beforeId [%s] it is expected to start with timestamp", id)
	}
	ts, _ := strconv.ParseInt(match[0], 10, 64)
	return time.UnixMilli(ts), nil
}

type DummyEventsLogService struct{}

func (d *DummyEventsLogService) Id() string {
	return "dummy"
}

func (d *DummyEventsLogService) PostAsync(_ *ActorEvent) {
}

func (d *DummyEventsLogService) PostEvent(_ *ActorEvent) (id EventsLogRecordId, err error) {
	return "", nil
}

func (d *DummyEventsLogService) GetEvents(eventType EventType, actorId string, level string, filter *EventsLogFilter, limit int) ([]EventsLogRecord, error) {
	return nil, nil
}

func (d *DummyEventsLogService) InsertTaskLog(level, logger, message, syncId, taskId string, timestamp time.Time) error {
	return nil
}

func (d *DummyEventsLogService) Close() error {
	return nil
}
