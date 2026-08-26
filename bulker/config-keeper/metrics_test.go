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

func TestRecordRepositoryRowsNonArrayPublishesZero(t *testing.T) {
	// a row-tracked repo is a JSON array by contract; a non-array payload is a
	// bad-deploy signal and must surface as 0, not freeze the last good count
	recordRepositoryRows("nonarray-repo", []byte(rowsPayload(40, `{"a":1}`)))
	require.Equal(t, 40.0, testutil.ToFloat64(repositoryRows.WithLabelValues("nonarray-repo")))
	recordRepositoryRows("nonarray-repo", []byte(`{"unexpected":"object"}`))
	require.Equal(t, 0.0, testutil.ToFloat64(repositoryRows.WithLabelValues("nonarray-repo")))
	// empty name (p.js and the breaker's embedded raw) never publishes
	recordRepositoryRows("", []byte("function(){}"))
}

func TestRecordRepositoryRowsCountsElementsNotDistinctIds(t *testing.T) {
	// duplicate ids collapse in the breaker's id-keyed baseline; the rows
	// metric must still report actual array length
	dup := `[{"id":"a"},{"id":"a"},{"id":"a"},{"id":"b"}]`
	recordRepositoryRows("dup-repo", []byte(dup))
	require.Equal(t, 4.0, testutil.ToFloat64(repositoryRows.WithLabelValues("dup-repo")))
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
