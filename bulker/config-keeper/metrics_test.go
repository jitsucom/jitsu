package main

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus/testutil"
	"github.com/stretchr/testify/require"
)

func TestRecordRepositoryRowsCountsArrayElements(t *testing.T) {
	recordRepositoryRows("test-repo", []byte(rowsPayload(30, `{"a":1}`)))
	require.Equal(t, 30.0, testutil.ToFloat64(repositoryRows.WithLabelValues("test-repo")))

	// a shrunk payload updates the gauge down — the JITSU-158 signal
	recordRepositoryRows("test-repo", []byte(rowsPayload(3, `{"a":1}`)))
	require.Equal(t, 3.0, testutil.ToFloat64(repositoryRows.WithLabelValues("test-repo")))
}

func TestRecordRepositoryRowsSkipsNonArray(t *testing.T) {
	// p.js-style non-array payload must not error or publish a bogus count
	recordRepositoryRows("script-repo", []byte("function(){}"))
	require.Equal(t, 0.0, testutil.ToFloat64(repositoryRows.WithLabelValues("script-repo")))
	// empty name never publishes
	recordRepositoryRows("", []byte(rowsPayload(5, `{"a":1}`)))
}

func TestBreakerEmitsRowsAndHeld(t *testing.T) {
	b := NewBreakerRepositoryData("bulker-connections-rows", BreakerConfig{MaxChangePercent: 50, MaxRemovePercent: 50, MinChangedRows: 20}, "")
	// fresh breaker is not held
	require.Equal(t, 0.0, testutil.ToFloat64(repositoryBreakerHeld.WithLabelValues("bulker-connections-rows")))

	// first accepted generation publishes the row count
	require.NoError(t, breakerInit(b, rowsPayload(100, `{"mode":"batch"}`)))
	require.Equal(t, 100.0, testutil.ToFloat64(repositoryRows.WithLabelValues("bulker-connections-rows")))
	require.Equal(t, 0.0, testutil.ToFloat64(repositoryBreakerHeld.WithLabelValues("bulker-connections-rows")))

	// a mass change trips the breaker: held goes to 1 and the rows gauge keeps
	// the held (good) size, NOT the rejected payload's
	changed := make([]string, 100)
	for i := range changed {
		changed[i] = fmt.Sprintf(`{"id":"conn%03d","options":{"mode":"stream"}}`, i)
	}
	require.Error(t, b.Init(strings.NewReader("["+strings.Join(changed, ",")+"]"), time.Now()))
	require.True(t, b.Held())
	require.Equal(t, 1.0, testutil.ToFloat64(repositoryBreakerHeld.WithLabelValues("bulker-connections-rows")))
	require.Equal(t, 100.0, testutil.ToFloat64(repositoryRows.WithLabelValues("bulker-connections-rows")))
}
