package main

import (
	"strconv"
	"testing"
	"time"

	"github.com/jitsucom/bulker/jitsubase/timestamp"
	"github.com/stretchr/testify/require"
)

func execEntry(eventIndex int, dropped bool, errMsg string) FunctionExecLogEntry {
	e := FunctionExecLogEntry{EventIndex: eventIndex, FunctionId: "udf.x", Dropped: dropped}
	if errMsg != "" {
		e.Error = &struct {
			Name    string `json:"name"`
			Message string `json:"message"`
		}{Name: "Error", Message: errMsg}
	}
	return e
}

func TestBuildSyncMetrics(t *testing.T) {
	// 2024-01-15T10:30:45Z → hour-truncated to 10:00:00, second-of-hour offset = 30*60+45 = 1845
	receivedAt, err := timestamp.ParseISOFormat("2024-01-15T10:30:45.000Z")
	require.NoError(t, err)
	const wantOffset = 30*60 + 45

	destinations := []*ShortDestinationConfig{
		{Id: "dst_success", ConnectionId: "con_success", DestinationType: "ga4-tag"},
		{Id: "dst_error", ConnectionId: "con_error", DestinationType: "facebook"},
		{Id: "dst_dropped", ConnectionId: "con_dropped", DestinationType: "webhook"},
	}
	result := map[string]ConnectionChainResult{
		// plain success
		"con_success": {ExecLog: []FunctionExecLogEntry{execEntry(0, false, "")}},
		// error wins over a later dropped on the same event
		"con_error": {ExecLog: []FunctionExecLogEntry{execEntry(0, false, "boom"), execEntry(0, true, "")}},
		// dropped (no error)
		"con_dropped": {ExecLog: []FunctionExecLogEntry{execEntry(0, true, "")}},
	}

	connMsgs, billingMsgs := buildSyncMetrics("ws1", "stream1", destinations, result, "msg123", receivedAt)

	// One connection-metrics row per connection (single event each).
	require.Len(t, connMsgs, 3)
	byConn := map[string]connMetricMessage{}
	for _, m := range connMsgs {
		byConn[m.ConnectionId] = m
		require.Equal(t, "ws1", m.WorkspaceId)
		require.Equal(t, "stream1", m.StreamId)
		require.Equal(t, "msg123", m.MessageId)
		require.Equal(t, int64(1), m.Events)
		require.Equal(t, "2024-01-15T10:30:45.000000Z", m.Timestamp)
	}
	require.Equal(t, "success", byConn["con_success"].Status)
	require.Equal(t, "error", byConn["con_error"].Status)
	require.Equal(t, "dropped", byConn["con_dropped"].Status)
	require.Equal(t, "dst_error", byConn["con_error"].DestinationId)
	require.Equal(t, "builtin.destination.facebook", byConn["con_error"].FunctionId)

	// Billing: success + error are billed, dropped is not.
	require.Len(t, billingMsgs, 2)
	keys := map[string]activeIncomingMessage{}
	for _, m := range billingMsgs {
		keys[m.MessageId] = m
		require.Equal(t, "ws1", m.WorkspaceId)
		// timestamp is hour-truncated
		require.Equal(t, "2024-01-15T10:00:00.000000Z", m.Timestamp)
	}
	wantKey := "msg123_0_" + strconv.Itoa(wantOffset)
	require.Contains(t, keys, wantKey)
	require.Len(t, keys, 1) // both billed rows share the same composed key (same event) → would dedupe downstream
}

func TestBuildSyncMetrics_EmptyExecLogStillCounts(t *testing.T) {
	receivedAt := time.Unix(3600, 0).UTC()
	result := map[string]ConnectionChainResult{
		"con1": {ExecLog: nil},
	}
	connMsgs, billingMsgs := buildSyncMetrics("ws1", "stream1", nil, result, "m", receivedAt)
	require.Len(t, connMsgs, 1)
	require.Equal(t, "success", connMsgs[0].Status)
	require.Equal(t, "con1", connMsgs[0].DestinationId) // no destination config → falls back to connectionId
	require.Equal(t, "builtin.destination.tag", connMsgs[0].FunctionId)
	require.Len(t, billingMsgs, 1)
	require.Equal(t, "m_0_0", billingMsgs[0].MessageId)
}
