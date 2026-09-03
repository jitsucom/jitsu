package main

import (
	"compress/gzip"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// producedMessage is one message the worker would have sent to Kafka
type producedMessage struct {
	topic         string
	connectionIds string
	messageId     string
}

// fakeProducer captures what the worker produces instead of talking to Kafka
type fakeProducer struct {
	sent   []producedMessage
	failOn string // messageId to fail on, to exercise the abort path
	err    error
}

func (f *fakeProducer) ProduceAsync(topic, messageKey string, event []byte, headers map[string]string,
	partition int32, originalTopic string, retry bool, timeout time.Duration) error {
	var decoded struct {
		MessageId string `json:"messageId"`
	}
	if err := json.Unmarshal(event, &decoded); err != nil {
		return err
	}
	if f.failOn != "" && decoded.MessageId == f.failOn {
		return f.err
	}
	f.sent = append(f.sent, producedMessage{
		topic:         topic,
		connectionIds: headers["connection_ids"],
		messageId:     decoded.MessageId,
	})
	return nil
}

// event renders one failover log line
func event(messageId, sourceId, created string) string {
	return eventWithType(messageId, sourceId, created, "track", "")
}

func eventWithType(messageId, sourceId, created, eventType, eventName string) string {
	payload := map[string]interface{}{"type": eventType}
	if eventName != "" {
		payload["event"] = eventName
	}
	message := map[string]interface{}{
		"messageId":      messageId,
		"messageCreated": created,
		"type":           eventType,
		"origin":         map[string]string{"sourceId": sourceId, "slug": sourceId + "-slug"},
		"httpPayload":    payload,
	}
	line, _ := json.Marshal(message)
	return string(line)
}

// writeLogFile writes a failover log to disk, gzipped when the name says so
func writeLogFile(t *testing.T, dir, name string, events []string) FileItem {
	t.Helper()
	path := filepath.Join(dir, name)
	file, err := os.Create(path)
	if err != nil {
		t.Fatalf("create %s: %v", path, err)
	}
	defer file.Close()

	var body []byte
	for _, e := range events {
		body = append(body, []byte(e+"\n")...)
	}
	if filepath.Ext(name) == ".gz" {
		gz := gzip.NewWriter(file)
		if _, err := gz.Write(body); err != nil {
			t.Fatalf("gzip write: %v", err)
		}
		if err := gz.Close(); err != nil {
			t.Fatalf("gzip close: %v", err)
		}
	} else if _, err := file.Write(body); err != nil {
		t.Fatalf("write: %v", err)
	}

	info, err := file.Stat()
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	return FileItem{Path: path, Size: info.Size()}
}

// runFile processes one local failover file the way a worker pod does
func runFile(t *testing.T, file FileItem, config string, streams *Streams, producer *fakeProducer) *WorkerStatus {
	t.Helper()
	parsed := jobConfig(t, config)
	rules := parseConnectionRules(parsed)
	status := &WorkerStatus{}
	// dbpool is only touched every 100k lines, s3Client only for s3:// paths
	err := processFile(file, parsed, rules, producer, nil, nil, streams,
		&WorkerConfig{JobID: "test", KafkaTopicName: "destination-messages"}, status, nil, false)
	if err != nil {
		t.Fatalf("processFile: %v", err)
	}
	return status
}

func sentIds(producer *fakeProducer) []string {
	ids := make([]string, 0, len(producer.sent))
	for _, m := range producer.sent {
		ids = append(ids, m.messageId)
	}
	return ids
}

// End-to-end over real files on disk: read (plain and gzipped) -> parse ->
// select streams -> resolve connections -> produce.
func TestReprocessLocalFiles(t *testing.T) {
	dir := t.TempDir()
	events := []string{
		event("e1", "s1", "2026-07-30T10:00:00Z"),
		event("e2", "s2", "2026-07-30T11:00:00Z"),
		event("e3", "s3", "2026-07-30T12:00:00Z"),
		event("e4", "s1", "2026-07-30T13:00:00Z"),
	}
	plain := writeLogFile(t, dir, "failover-2026_07_30T09_00_00.ndjson", events)
	gzipped := writeLogFile(t, dir, "failover-2026_07_30T14_00_00.ndjson.gz", events)

	streams := testStreams(map[string][]string{
		"s1": {"m1", "m2"},
		"s2": {"m3"},
		"s3": {"m4"},
	})

	tests := []struct {
		name        string
		file        FileItem
		config      string
		wantSent    []string
		wantConns   map[string]string // messageId -> connection_ids header
		wantSkipped int64
		wantErrors  int64
	}{
		{
			name:      "no selector reprocesses everything to its mapping",
			file:      plain,
			config:    `{"batch_size": 2}`,
			wantSent:  []string{"e1", "e2", "e3", "e4"},
			wantConns: map[string]string{"e1": "m1,m2", "e2": "m3", "e3": "m4", "e4": "m1,m2"},
		},
		{
			name:        "plain stream filter",
			file:        plain,
			config:      `{"batch_size": 2, "stream_ids": ["s1"]}`,
			wantSent:    []string{"e1", "e4"},
			wantConns:   map[string]string{"e1": "m1,m2", "e4": "m1,m2"},
			wantSkipped: 2,
		},
		{
			name:        "map form overrides connections and excludes unlisted streams",
			file:        plain,
			config:      `{"batch_size": 2, "stream_ids": {"s1": ["c1", "c2"], "s2": "c3"}}`,
			wantSent:    []string{"e1", "e2", "e4"},
			wantConns:   map[string]string{"e1": "c1,c2", "e2": "c3", "e4": "c1,c2"},
			wantSkipped: 1,
		},
		{
			name:      "wildcard key with wildcard connection replays everything as mapped",
			file:      plain,
			config:    `{"batch_size": 2, "stream_ids": {"*": "*"}}`,
			wantSent:  []string{"e1", "e2", "e3", "e4"},
			wantConns: map[string]string{"e1": "m1,m2", "e2": "m3", "e3": "m4", "e4": "m1,m2"},
		},
		{
			name:      "wildcard connection plus an extra id",
			file:      plain,
			config:    `{"batch_size": 2, "stream_ids": {"s1": ["*", "extra"]}}`,
			wantSent:  []string{"e1", "e4"},
			wantConns: map[string]string{"e1": "m1,m2,extra", "e4": "m1,m2,extra"},
			// s2 and s3 are not selected
			wantSkipped: 2,
		},
		{
			name:      "filter mode narrows the mapping",
			file:      plain,
			config:    `{"batch_size": 2, "stream_ids": {"s1": "m2", "*": "*"}, "connections_filter": true}`,
			wantSent:  []string{"e1", "e2", "e3", "e4"},
			wantConns: map[string]string{"e1": "m2", "e2": "m3", "e3": "m4", "e4": "m2"},
		},
		{
			name:        "filter that matches nothing skips the stream's events",
			file:        plain,
			config:      `{"batch_size": 2, "stream_ids": {"s1": "nope"}, "connections_filter": true}`,
			wantSkipped: 4, // 2 unselected streams + 2 events with an empty filter result
		},
		{
			name:        "explicitly empty selector reprocesses nothing",
			file:        plain,
			config:      `{"batch_size": 2, "stream_ids": {}}`,
			wantSkipped: 4,
		},
		{
			name:        "date range narrows the events",
			file:        plain,
			config:      `{"batch_size": 2, "date_from": "2026-07-30T11:00:00Z", "date_to": "2026-07-30T12:00:00Z"}`,
			wantSent:    []string{"e2", "e3"},
			wantConns:   map[string]string{"e2": "m3", "e3": "m4"},
			wantSkipped: 2,
		},
		{
			name:      "gzipped files are read the same way",
			file:      gzipped,
			config:    `{"batch_size": 3, "stream_ids": {"s1": "c1"}}`,
			wantSent:  []string{"e1", "e4"},
			wantConns: map[string]string{"e1": "c1", "e4": "c1"},
			// s2 and s3 are not selected
			wantSkipped: 2,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			producer := &fakeProducer{}
			status := runFile(t, tt.file, tt.config, streams, producer)

			if !sameIds(sentIds(producer), tt.wantSent) {
				t.Errorf("produced %v, want %v", sentIds(producer), tt.wantSent)
			}
			for _, m := range producer.sent {
				if want, ok := tt.wantConns[m.messageId]; ok && m.connectionIds != want {
					t.Errorf("%s connection_ids = %q, want %q", m.messageId, m.connectionIds, want)
				}
				if m.topic != "destination-messages" {
					t.Errorf("%s topic = %q", m.messageId, m.topic)
				}
			}
			if status.SuccessCount != int64(len(tt.wantSent)) {
				t.Errorf("SuccessCount = %d, want %d", status.SuccessCount, len(tt.wantSent))
			}
			if status.SkippedCount != tt.wantSkipped {
				t.Errorf("SkippedCount = %d, want %d", status.SkippedCount, tt.wantSkipped)
			}
			if status.ErrorCount != tt.wantErrors {
				t.Errorf("ErrorCount = %d, want %d", status.ErrorCount, tt.wantErrors)
			}
			if status.TotalLines != 4 {
				t.Errorf("TotalLines = %d, want 4", status.TotalLines)
			}
			// every line lands in exactly one bucket
			if total := status.SuccessCount + status.SkippedCount + status.ErrorCount; total != status.TotalLines {
				t.Errorf("accounting: %d success + %d skipped + %d errors != %d lines",
					status.SuccessCount, status.SkippedCount, status.ErrorCount, status.TotalLines)
			}
		})
	}
}

func TestReprocessEventAllowlist(t *testing.T) {
	dir := t.TempDir()
	file := writeLogFile(t, dir, "failover-2026_07_30T09_00_00.ndjson", []string{
		eventWithType("e1", "s1", "2026-07-30T10:00:00Z", "page", ""),
		eventWithType("e2", "s1", "2026-07-30T11:00:00Z", "track", "signup"),
		eventWithType("e3", "s1", "2026-07-30T12:00:00Z", "track", "purchase"),
		eventWithType("e4", "s1", "2026-07-30T13:00:00Z", "identify", ""),
	})
	producer := &fakeProducer{}
	status := runFile(t, file, `{"events":["page","signup"]}`, testStreams(map[string][]string{"s1": {"m1"}}), producer)

	if !sameIds(sentIds(producer), []string{"e1", "e2"}) {
		t.Errorf("produced %v, want [e1 e2]", sentIds(producer))
	}
	if status.SuccessCount != 2 || status.SkippedCount != 2 || status.ErrorCount != 0 || status.TotalLines != 4 {
		t.Errorf("unexpected status: %+v", status)
	}
}

// A produce failure aborts the batch; the failing message and the ones after it
// in that batch must be accounted for exactly once.
func TestReprocessLocalFilesProduceFailure(t *testing.T) {
	dir := t.TempDir()
	file := writeLogFile(t, dir, "failover-2026_07_30T09_00_00.ndjson", []string{
		event("e1", "s1", "2026-07-30T10:00:00Z"),
		event("e2", "s1", "2026-07-30T11:00:00Z"),
		event("e3", "s1", "2026-07-30T12:00:00Z"),
		event("e4", "s1", "2026-07-30T13:00:00Z"),
	})
	streams := testStreams(map[string][]string{"s1": {"m1"}})
	producer := &fakeProducer{failOn: "e2", err: os.ErrClosed}

	parsed := jobConfig(t, `{"batch_size": 4}`)
	status := &WorkerStatus{}
	err := processFile(file, parsed, parseConnectionRules(parsed), producer, nil, nil, streams,
		&WorkerConfig{JobID: "test", KafkaTopicName: "destination-messages"}, status, nil, false)
	if err != nil {
		t.Fatalf("processFile returned %v; the send failure is reported through status", err)
	}

	if !sameIds(sentIds(producer), []string{"e1"}) {
		t.Errorf("produced %v, want [e1]", sentIds(producer))
	}
	if status.SuccessCount != 1 {
		t.Errorf("SuccessCount = %d, want 1", status.SuccessCount)
	}
	// e2 failed and e3/e4 were never attempted — all three are errors, counted once
	if status.ErrorCount != 3 {
		t.Errorf("ErrorCount = %d, want 3", status.ErrorCount)
	}
	if total := status.SuccessCount + status.SkippedCount + status.ErrorCount; total != status.TotalLines {
		t.Errorf("accounting: %d success + %d skipped + %d errors != %d lines",
			status.SuccessCount, status.SkippedCount, status.ErrorCount, status.TotalLines)
	}
}

// queueStub reports a shrinking producer queue, then an error once "closed"
type queueStub struct {
	sizes []int
	calls int
	err   error
}

func (q *queueStub) QueueSize() (int, error) {
	if q.err != nil {
		return 0, q.err
	}
	if q.calls < len(q.sizes) {
		size := q.sizes[q.calls]
		q.calls++
		return size, nil
	}
	return 0, nil
}

// The tail of a run is still in the producer queue when the last file is done —
// reporting completion before it drains would claim delivery for messages that
// never left the worker.
func TestDrainProducer(t *testing.T) {
	t.Run("waits for the queue to empty", func(t *testing.T) {
		stub := &queueStub{sizes: []int{23, 9, 0}}
		if undelivered := drainProducer(stub, time.Second, time.Millisecond); undelivered != 0 {
			t.Errorf("undelivered = %d, want 0", undelivered)
		}
		if stub.calls != 3 {
			t.Errorf("polled %d times, want 3", stub.calls)
		}
	})

	t.Run("reports what is left when the wait runs out", func(t *testing.T) {
		stub := &queueStub{sizes: []int{5, 5, 5, 5, 5, 5, 5, 5, 5, 5}}
		if undelivered := drainProducer(stub, 5*time.Millisecond, time.Millisecond); undelivered != 5 {
			t.Errorf("undelivered = %d, want 5", undelivered)
		}
	})

	t.Run("a closed producer is not an error", func(t *testing.T) {
		if undelivered := drainProducer(&queueStub{err: os.ErrClosed}, time.Second, time.Millisecond); undelivered != 0 {
			t.Errorf("undelivered = %d, want 0", undelivered)
		}
	})
}

// Messages still queued at the end were already counted as sent — except when a
// file attempt failed and its counts were rolled back before the retry, leaving
// its messages in the queue with nothing to subtract them from.
func TestAccountUndelivered(t *testing.T) {
	tests := []struct {
		name        string
		status      WorkerStatus
		undelivered int
		wantSuccess int64
		wantErrors  int64
	}{
		{
			name:        "moves the undelivered out of success",
			status:      WorkerStatus{SuccessCount: 100, ErrorCount: 2},
			undelivered: 23,
			wantSuccess: 77,
			wantErrors:  25,
		},
		{
			// The surplus is duplicates from an attempt whose counts were rolled
			// back and whose lines were re-counted by the retry, so they are not
			// represented in the counters at all — adding them to errors would
			// push success+skipped+errors past the line count. LastError still
			// reports the real queue depth.
			name:        "never counts more than was reported as sent",
			status:      WorkerStatus{SuccessCount: 5, ErrorCount: 1},
			undelivered: 40,
			wantSuccess: 0,
			wantErrors:  6,
		},
		{
			name:        "nothing counted as sent leaves the counters alone",
			status:      WorkerStatus{SuccessCount: 0, ErrorCount: 3},
			undelivered: 7,
			wantSuccess: 0,
			wantErrors:  3,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			status := tt.status
			accountUndelivered(&status, tt.undelivered)
			if status.SuccessCount != tt.wantSuccess || status.ErrorCount != tt.wantErrors {
				t.Errorf("success/errors = %d/%d, want %d/%d",
					status.SuccessCount, status.ErrorCount, tt.wantSuccess, tt.wantErrors)
			}
			if status.SuccessCount < 0 {
				t.Errorf("SuccessCount went negative: %d", status.SuccessCount)
			}
		})
	}
}
