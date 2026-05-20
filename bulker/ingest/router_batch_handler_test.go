package main

import (
	"testing"
	"time"

	"github.com/jitsucom/bulker/jitsubase/types"
	"github.com/stretchr/testify/assert"
)

func TestDeduplicateBatch(t *testing.T) {
	tests := []struct {
		name     string
		batch    []types.Json
		gapMs    int
		expected int // expected number of events after deduplication
	}{
		{
			name:     "empty batch",
			batch:    []types.Json{},
			gapMs:    1000,
			expected: 0,
		},
		{
			name: "single event",
			batch: []types.Json{
				createEvent("anon1", "user1", "track", "test_event", time.Now(), nil, nil),
			},
			gapMs:    1000,
			expected: 1,
		},
		{
			name: "duplicate events within gap",
			batch: []types.Json{
				createEvent("anon1", "user1", "track", "test_event", time.Now(), types.JsonFromKV("prop", "value", "prop1", "value1"), types.JsonFromKV("trait", "value", "trait1", "value1")),
				createEvent("anon1", "user1", "track", "test_event", time.Now().Add(500*time.Millisecond), types.JsonFromKV("prop", "value", "prop1", "value1"), types.JsonFromKV("trait", "value", "trait1", "value1")),
			},
			gapMs:    1000,
			expected: 1, // second event should be filtered
		},
		{
			name: "duplicate events outside gap",
			batch: []types.Json{
				createEvent("anon1", "user1", "track", "test_event", time.Now(), types.JsonFromKV("prop", "value", "prop1", "value1"), types.JsonFromKV("trait", "value", "trait1", "value1")),
				createEvent("anon1", "user1", "track", "test_event", time.Now().Add(1500*time.Millisecond), types.JsonFromKV("prop", "value", "prop1", "value1"), types.JsonFromKV("trait", "value", "trait1", "value1")),
			},
			gapMs:    1000,
			expected: 2, // both events should be kept
		},
		{
			name: "different anonymousId",
			batch: []types.Json{
				createEvent("anon1", "user1", "track", "test_event", time.Now(), nil, nil),
				createEvent("anon2", "user1", "track", "test_event", time.Now(), nil, nil),
			},
			gapMs:    1000,
			expected: 2, // different anonymousId means different events
		},
		{
			name: "different userId",
			batch: []types.Json{
				createEvent("anon1", "user1", "track", "test_event", time.Now(), nil, nil),
				createEvent("anon1", "user2", "track", "test_event", time.Now(), nil, nil),
			},
			gapMs:    1000,
			expected: 2, // different userId means different events
		},
		{
			name: "different event type",
			batch: []types.Json{
				createEvent("anon1", "user1", "track", "test_event", time.Now(), nil, nil),
				createEvent("anon1", "user1", "identify", "test_event", time.Now(), nil, nil),
			},
			gapMs:    1000,
			expected: 2, // different type means different events
		},
		{
			name: "different event name",
			batch: []types.Json{
				createEvent("anon1", "user1", "track", "event1", time.Now(), nil, nil),
				createEvent("anon1", "user1", "track", "event2", time.Now(), nil, nil),
			},
			gapMs:    1000,
			expected: 2, // different event name means different events
		},
		{
			name: "different properties",
			batch: []types.Json{
				createEvent("anon1", "user1", "track", "test_event", time.Now(), types.JsonFromKV("prop", "value1"), nil),
				createEvent("anon1", "user1", "track", "test_event", time.Now(), types.JsonFromKV("prop", "value2"), nil),
			},
			gapMs:    1000,
			expected: 2, // different properties means different events
		},
		{
			name: "different traits",
			batch: []types.Json{
				createEvent("anon1", "user1", "track", "test_event", time.Now(), nil, types.JsonFromKV("trait", "value1")),
				createEvent("anon1", "user1", "track", "test_event", time.Now(), nil, types.JsonFromKV("trait", "value2")),
			},
			gapMs:    1000,
			expected: 2, // different traits means different events
		},
		{
			name: "multiple duplicates with one unique",
			batch: []types.Json{
				createEvent("anon1", "user1", "track", "test_event", time.Now(), types.JsonFromKV("prop", "value"), nil),
				createEvent("anon1", "user1", "track", "test_event", time.Now().Add(100*time.Millisecond), types.JsonFromKV("prop", "value"), nil),
				createEvent("anon1", "user1", "track", "test_event", time.Now().Add(200*time.Millisecond), types.JsonFromKV("prop", "value"), nil),
				createEvent("anon2", "user1", "track", "test_event", time.Now(), types.JsonFromKV("prop", "value"), nil),
			},
			gapMs:    1000,
			expected: 2, // 3 duplicates -> 1, plus 1 unique = 2 total
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := deduplicateBatch(tt.batch, tt.gapMs)
			assert.Equal(t, tt.expected, len(result), "unexpected number of events after deduplication")
		})
	}
}

func TestApplySegmentTimestampCorrection(t *testing.T) {
	// Device clock is 20min behind server — exceeds significantClockSkew
	// (15min) so timestamps get rewritten.
	sentAt := "2026-05-15T10:00:00.000Z"
	receivedAt, err := time.Parse(time.RFC3339Nano, "2026-05-15T10:20:00.000Z")
	assert.NoError(t, err)

	t.Run("no sentAt is a no-op", func(t *testing.T) {
		ev := types.NewJson(4)
		ev.Set("timestamp", "2026-05-15T09:59:50.000Z")
		applySegmentTimestampCorrection([]types.Json{ev}, "", receivedAt)
		assert.Equal(t, "2026-05-15T09:59:50.000Z", ev.GetS("timestamp"))
		assert.Equal(t, "", ev.GetS("sentAt"))
		assert.Equal(t, "", ev.GetS("originalTimestamp"))
	})

	t.Run("unparseable sentAt is a no-op", func(t *testing.T) {
		ev := types.NewJson(4)
		ev.Set("timestamp", "2026-05-15T09:59:50.000Z")
		applySegmentTimestampCorrection([]types.Json{ev}, "not-a-date", receivedAt)
		assert.Equal(t, "2026-05-15T09:59:50.000Z", ev.GetS("timestamp"))
		assert.Equal(t, "", ev.GetS("sentAt"))
	})

	t.Run("adjusts timestamp by offset, does not add originalTimestamp", func(t *testing.T) {
		ev := types.NewJson(4)
		ev.Set("timestamp", "2026-05-15T09:59:50.000Z")
		applySegmentTimestampCorrection([]types.Json{ev}, sentAt, receivedAt)
		// offset = +20min, so timestamp shifts forward 20min.
		assert.Equal(t, "2026-05-15T10:19:50.000Z", ev.GetS("timestamp"))
		// originalTimestamp is intentionally NOT set — pre-correction
		// device timestamp is recoverable as timestamp - (receivedAt -
		// sentAt) and we don't want to leak a Segment-only field into
		// downstream warehouse schemas.
		assert.Equal(t, "", ev.GetS("originalTimestamp"))
		assert.Equal(t, sentAt, ev.GetS("sentAt"))
	})

	t.Run("event without timestamp gets sentAt only", func(t *testing.T) {
		ev := types.NewJson(4)
		applySegmentTimestampCorrection([]types.Json{ev}, sentAt, receivedAt)
		assert.Equal(t, sentAt, ev.GetS("sentAt"))
		assert.Equal(t, "", ev.GetS("timestamp"))
		assert.Equal(t, "", ev.GetS("originalTimestamp"))
	})

	t.Run("preserves event-level sentAt and any pre-set originalTimestamp", func(t *testing.T) {
		// If the upstream payload already carried originalTimestamp on
		// the event (e.g., relayed from another collector), leave it
		// alone — we just don't add it ourselves.
		ev := types.NewJson(4)
		ev.Set("timestamp", "2026-05-15T09:59:50.000Z")
		ev.Set("originalTimestamp", "2026-05-15T09:59:00.000Z")
		ev.Set("sentAt", "2026-05-15T09:59:55.000Z")
		applySegmentTimestampCorrection([]types.Json{ev}, sentAt, receivedAt)
		// timestamp still gets shifted by the batch offset.
		assert.Equal(t, "2026-05-15T10:19:50.000Z", ev.GetS("timestamp"))
		assert.Equal(t, "2026-05-15T09:59:00.000Z", ev.GetS("originalTimestamp"))
		assert.Equal(t, "2026-05-15T09:59:55.000Z", ev.GetS("sentAt"))
	})

	t.Run("server clock behind device produces negative offset", func(t *testing.T) {
		// Device 20min ahead of server (offset = -20min).
		laterSentAt := "2026-05-15T10:40:00.000Z"
		ev := types.NewJson(4)
		ev.Set("timestamp", "2026-05-15T10:30:00.000Z")
		applySegmentTimestampCorrection([]types.Json{ev}, laterSentAt, receivedAt)
		// offset = -20min, so timestamp shifts back 20min.
		assert.Equal(t, "2026-05-15T10:10:00.000Z", ev.GetS("timestamp"))
		assert.Equal(t, "", ev.GetS("originalTimestamp"))
	})

	t.Run("sub-threshold skew leaves timestamp untouched but still propagates sentAt", func(t *testing.T) {
		// 2min offset — below significantClockSkew (5min). The device
		// timestamp is kept as-is; only sentAt is propagated.
		smallSkewSentAt := "2026-05-15T10:18:00.000Z"
		ev := types.NewJson(4)
		ev.Set("timestamp", "2026-05-15T10:14:50.000Z")
		applySegmentTimestampCorrection([]types.Json{ev}, smallSkewSentAt, receivedAt)
		assert.Equal(t, "2026-05-15T10:14:50.000Z", ev.GetS("timestamp"))
		assert.Equal(t, smallSkewSentAt, ev.GetS("sentAt"))
		assert.Equal(t, "", ev.GetS("originalTimestamp"))
	})
}

// Helper function to create test events
func createEvent(anonymousId, userId, eventType, eventName string, ts time.Time, properties types.Json, traits types.Json) types.Json {
	event := types.NewJson(10)
	if anonymousId != "" {
		event.Set("anonymousId", anonymousId)
	}
	if userId != "" {
		event.Set("userId", userId)
	}
	if eventType != "" {
		event.Set("type", eventType)
	}
	if eventName != "" {
		event.Set("event", eventName)
	}
	event.Set("timestamp", ts.Format(time.RFC3339Nano))

	if properties != nil {
		event.Set("properties", properties)
	}
	if traits != nil {
		event.Set("traits", traits)
	}

	return event
}
