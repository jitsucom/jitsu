package eventslog

import (
	"context"
	"crypto/tls"
	"database/sql"
	"fmt"
	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/jitsucom/bulker/jitsubase/appbase"
	"github.com/jitsucom/bulker/jitsubase/jsonorder"
	"github.com/jitsucom/bulker/jitsubase/safego"
	"github.com/jitsucom/bulker/jitsubase/utils"
	"slices"

	"sync"
	"time"
)

const chEventsLogServiceName = "ch_events_log"

type ClickhouseEventsLog struct {
	sync.Mutex
	appbase.Service
	conn                  *sql.DB
	eventsBuffer          []*ActorEvent
	periodicFlushInterval time.Duration
	closeChan             chan struct{}
}

func (r *ClickhouseEventsLog) Id() string {
	return "clickhouse"
}

func NewClickhouseEventsLog(config EventsLogConfig) (EventsLogService, error) {
	base := appbase.NewServiceBase(chEventsLogServiceName)

	// Parse configuration from URL and env vars
	chConfig, err := utils.GetClickhouseConfig(&config)
	if err != nil {
		return nil, fmt.Errorf("failed to parse clickhouse config: %w", err)
	}

	opts := &clickhouse.Options{
		Addr: []string{chConfig.GetAddr()},
		Auth: clickhouse.Auth{
			Database: chConfig.Database,
			Username: chConfig.Username,
			Password: chConfig.Password,
		},
		Settings: clickhouse.Settings{
			"async_insert":                 1,
			"wait_for_async_insert":        0,
			"async_insert_busy_timeout_ms": 10000,
			"date_time_input_format":       "best_effort",
		},
		Compression: &clickhouse.Compression{
			Method: clickhouse.CompressionLZ4,
		},
		Protocol:    clickhouse.HTTP,
		DialTimeout: time.Second * 5,
	}
	if chConfig.SSL {
		opts.TLS = &tls.Config{
			InsecureSkipVerify: true,
		}
	}
	conn := clickhouse.OpenDB(opts)
	c := ClickhouseEventsLog{
		Service:               base,
		conn:                  conn,
		eventsBuffer:          make([]*ActorEvent, 0, 1000),
		periodicFlushInterval: time.Second * 5,
		closeChan:             make(chan struct{}),
	}
	c.Start()
	return &c, nil
}

func (r *ClickhouseEventsLog) Start() {
	safego.RunWithRestart(func() {
		ticker := time.NewTicker(r.periodicFlushInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				r.flush()
			case <-r.closeChan:
				return
			}
		}
	})
}

func (r *ClickhouseEventsLog) flush() {
	r.Lock()
	if len(r.eventsBuffer) == 0 {
		r.Unlock()
		return
	}
	tm := time.Now()
	bufferCopy := slices.Clone(r.eventsBuffer)
	clear(r.eventsBuffer)
	r.eventsBuffer = r.eventsBuffer[:0]
	r.Unlock()
	ctx, cancel := context.WithDeadline(context.Background(), time.Now().Add(r.periodicFlushInterval))
	defer cancel()
	scope, err := r.conn.BeginTx(ctx, nil)
	if err != nil {
		r.Errorf("Error starting transaction: %v", err)
		return
	}
	batch, err := scope.PrepareContext(ctx, "INSERT INTO events_log SETTINGS async_insert=1, wait_for_async_insert=0")
	if err != nil {
		r.Errorf("Error preparing batch: %v", err)
		_ = scope.Rollback()
		return
	}
	for _, event := range bufferCopy {
		bytes, _ := jsonorder.Marshal(event.Event)
		_, err = batch.Exec(
			event.Timestamp,
			event.ActorId,
			string(event.EventType),
			string(event.Level),
			string(bytes),
		)
		if err != nil {
			r.Errorf("Error appending to batch: %v", err)
			_ = scope.Rollback()
			return
		}
	}
	err = scope.Commit()
	if err != nil {
		r.Errorf("Error sending batch: %v", err)
		_ = scope.Rollback()
	} else {
		r.Debugf("Inserted %d events in %v", len(bufferCopy), time.Since(tm))
	}
}

func (r *ClickhouseEventsLog) PostAsync(event *ActorEvent) {
	if event == nil {
		return
	}
	r.Lock()
	defer r.Unlock()
	event.Timestamp = time.Now().UTC()
	r.eventsBuffer = append(r.eventsBuffer, event)
}

func (r *ClickhouseEventsLog) PostEvent(event *ActorEvent) (id EventsLogRecordId, err error) {
	bytes, _ := jsonorder.Marshal(event.Event)
	_, err = r.conn.Exec("INSERT INTO events_log SETTINGS async_insert=1, wait_for_async_insert=0 VALUES (?,?,?,?,?)", event.Timestamp, event.ActorId, string(event.EventType), string(event.Level), string(bytes))
	return
}

func (r *ClickhouseEventsLog) GetEvents(eventType EventType, actorId string, level string, filter *EventsLogFilter, limit int) ([]EventsLogRecord, error) {
	return nil, fmt.Errorf("not implemented")
}

func (r *ClickhouseEventsLog) InsertTaskLog(level, logger, message, syncId, taskId string, timestamp time.Time) error {
	_, err := r.conn.Exec("INSERT INTO task_log(task_id, sync_id, timestamp, level, logger, message) SETTINGS async_insert=1, wait_for_async_insert=0, async_insert_busy_timeout_ms=1000 VALUES (?,?,?,?,?,?)", taskId, syncId, timestamp.UnixMilli(), level, logger, message)
	return err
}

func (r *ClickhouseEventsLog) Close() error {
	r.closeChan <- struct{}{}
	_ = r.conn.Close()
	return nil
}
