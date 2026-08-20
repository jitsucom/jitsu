package main

import (
	"fmt"
	"os"
	"path"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func rowsPayload(n int, value string) string {
	rows := make([]string, n)
	for i := 0; i < n; i++ {
		rows[i] = fmt.Sprintf(`{"id":"conn%03d","options":%s}`, i, value)
	}
	return "[" + strings.Join(rows, ",") + "]"
}

// breakerInit mimics the loadCached path (tag is always nil there)
func breakerInit(b *BreakerRepositoryData, payload string) error {
	return b.Init(strings.NewReader(payload), nil)
}

// breakerInitNetwork mimics a network refresh, which carries a Last-Modified tag
func breakerInitNetwork(b *BreakerRepositoryData, payload string) error {
	return b.Init(strings.NewReader(payload), time.Now())
}

func testBreaker() *BreakerRepositoryData {
	return NewBreakerRepositoryData("bulker-connections", BreakerConfig{MaxChangePercent: 50, MaxRemovePercent: 50, MinChangedRows: 20}, "")
}

func TestBreakerFirstLoadAccepted(t *testing.T) {
	b := testBreaker()
	require.NoError(t, breakerInit(b, rowsPayload(100, `{"mode":"batch"}`)))
	require.NotNil(t, b.GetData())
	require.False(t, b.Held())
}

func TestBreakerSmallChangeAccepted(t *testing.T) {
	b := testBreaker()
	require.NoError(t, breakerInit(b, rowsPayload(100, `{"mode":"batch"}`)))
	// 10 of 100 rows change (10% < 50%) — accepted
	var rows []string
	for i := 0; i < 90; i++ {
		rows = append(rows, fmt.Sprintf(`{"id":"conn%03d","options":{"mode":"batch"}}`, i))
	}
	for i := 90; i < 100; i++ {
		rows = append(rows, fmt.Sprintf(`{"id":"conn%03d","options":{"mode":"stream"}}`, i))
	}
	require.NoError(t, breakerInit(b, "["+strings.Join(rows, ",")+"]"))
	require.False(t, b.Held())
}

func TestBreakerTripsOnMassChange(t *testing.T) {
	b := testBreaker()
	good := rowsPayload(100, `{"mode":"batch","deduplicate":true}`)
	require.NoError(t, breakerInit(b, good))

	// the incident shape: every row's options blanked at once
	blanked := rowsPayload(100, `{}`)
	err := breakerInit(b, blanked)
	require.Error(t, err)
	require.Contains(t, err.Error(), "circuit breaker")
	require.True(t, b.Held())
	// last-known-good is still served
	require.Equal(t, good, string(*b.GetData()))

	// a sane payload recovers without operator action
	require.NoError(t, breakerInit(b, good))
	require.False(t, b.Held())
}

func TestBreakerFloorSuppressesSmallFleets(t *testing.T) {
	b := testBreaker()
	require.NoError(t, breakerInit(b, rowsPayload(10, `{"a":1}`)))
	// 100% changed but only 10 rows < MinChangedRows=20 — accepted
	require.NoError(t, breakerInit(b, rowsPayload(10, `{"a":2}`)))
	require.False(t, b.Held())
}

func TestBreakerAddsDoNotTrip(t *testing.T) {
	b := testBreaker()
	require.NoError(t, breakerInit(b, rowsPayload(100, `{"a":1}`)))
	// 300 new rows appear, none of the common rows changed — accepted
	require.NoError(t, breakerInit(b, rowsPayload(400, `{"a":1}`)))
	require.False(t, b.Held())
}

func TestBreakerModerateRemovalAccepted(t *testing.T) {
	b := testBreaker()
	require.NoError(t, breakerInit(b, rowsPayload(100, `{"a":1}`)))
	// 30% of rows removed (< 50%) — legitimate cleanup, accepted
	require.NoError(t, breakerInit(b, rowsPayload(70, `{"a":1}`)))
	require.False(t, b.Held())
}

func TestBreakerTripsOnMassRemoval(t *testing.T) {
	b := testBreaker()
	good := rowsPayload(100, `{"a":1}`)
	require.NoError(t, breakerInit(b, good))
	// a console bug filtering out most rows is as destructive as blanking
	// them: 70% of the baseline vanishing at once must trip
	err := breakerInit(b, rowsPayload(30, `{"a":1}`))
	require.Error(t, err)
	require.Contains(t, err.Error(), "removed")
	require.True(t, b.Held())
	require.Equal(t, good, string(*b.GetData()))
	// recovery when rows come back
	require.NoError(t, breakerInit(b, good))
	require.False(t, b.Held())
}

func TestBreakerRemovalFloor(t *testing.T) {
	// 100% of a 10-row fleet removed: below the 20-row floor — accepted
	b := testBreaker()
	require.NoError(t, breakerInit(b, rowsPayload(10, `{"a":1}`)))
	require.NoError(t, breakerInit(b, `[]`))
	require.False(t, b.Held())
}

func TestBreakerOperatorAccept(t *testing.T) {
	b := testBreaker()
	good := rowsPayload(100, `{"mode":"batch"}`)
	require.NoError(t, breakerInit(b, good))
	blanked := rowsPayload(100, `{}`)
	require.Error(t, breakerInit(b, blanked))
	require.True(t, b.Held())

	b.AcceptNext()
	require.NoError(t, breakerInit(b, blanked))
	require.False(t, b.Held())
	require.Equal(t, blanked, string(*b.GetData()))

	// acceptance is one-shot: the accepted generation is the new baseline and
	// the next mass change trips again
	require.Error(t, breakerInit(b, rowsPayload(100, `{"x":9}`)))
}

func TestBreakerAcceptArmExpires(t *testing.T) {
	b := testBreaker()
	clock := time.Now()
	b.now = func() time.Time { return clock }

	good := rowsPayload(100, `{"mode":"batch"}`)
	require.NoError(t, breakerInit(b, good))
	blanked := rowsPayload(100, `{}`)

	// a pre-arm bounded by TTL: after expiry it must not bypass a trip —
	// a forgotten arm cannot silently accept a future incident
	b.AcceptNext()
	clock = clock.Add(acceptTTL + time.Minute)
	require.Error(t, breakerInit(b, blanked))
	require.True(t, b.Held())

	// a fresh arm within TTL works
	b.AcceptNext()
	clock = clock.Add(acceptTTL / 2)
	require.NoError(t, breakerInit(b, blanked))
	require.False(t, b.Held())
}

func TestBreakerRejectsInvalidJSON(t *testing.T) {
	b := testBreaker()
	good := rowsPayload(30, `{"a":1}`)
	require.NoError(t, breakerInit(b, good))
	require.Error(t, breakerInit(b, `{"not":"an array"`))
	require.Error(t, breakerInit(b, `{"not":"an array"}`))
	require.Equal(t, good, string(*b.GetData()))
}

func TestBreakerBaselineSeededFromCache(t *testing.T) {
	dir := t.TempDir()
	good := rowsPayload(100, `{"mode":"batch"}`)
	require.NoError(t, os.WriteFile(path.Join(dir, "bulker-connections"), []byte(good), 0644))

	// a fresh process (pod restart mid-incident) must compare its first fetch
	// against the pre-restart baseline, not accept it unconditionally
	b := NewBreakerRepositoryData("bulker-connections", BreakerConfig{MaxChangePercent: 50, MinChangedRows: 20}, dir)
	err := breakerInit(b, rowsPayload(100, `{}`))
	require.Error(t, err)
	require.Contains(t, err.Error(), "circuit breaker")
	// the first zero-diff init after a restart trip is the loadCached replay
	// (held persists) — full lifecycle covered in
	// TestBreakerBootstrapCacheReplayKeepsHeld
}

func TestBreakerBootstrapCacheReplayKeepsHeld(t *testing.T) {
	dir := t.TempDir()
	good := rowsPayload(100, `{"mode":"batch"}`)
	require.NoError(t, os.WriteFile(path.Join(dir, "bulker-connections"), []byte(good), 0644))

	// restart mid-incident: first network fetch is bad → trip; the framework
	// then falls back to the on-disk cache (loadCached), replaying the very
	// bytes the baseline was seeded from. That must serve data but NOT count
	// as a recovery — held state and reason stay
	b := NewBreakerRepositoryData("bulker-connections", BreakerConfig{MaxChangePercent: 50, MinChangedRows: 20}, dir)
	require.Error(t, breakerInit(b, rowsPayload(100, `{}`)))
	require.True(t, b.Held())

	require.NoError(t, breakerInit(b, good)) // loadCached replay
	require.True(t, b.Held(), "cache replay must not clear the held state")
	require.Equal(t, good, string(*b.GetData()))
	require.NotNil(t, b.Status())

	// a genuinely recovered network payload clears it (data already serving)
	require.NoError(t, breakerInit(b, good))
	require.False(t, b.Held())
}

func TestBreakerNetworkZeroDiffRecoveryClearsHeld(t *testing.T) {
	dir := t.TempDir()
	good := rowsPayload(100, `{"mode":"batch"}`)
	require.NoError(t, os.WriteFile(path.Join(dir, "bulker-connections"), []byte(good), 0644))

	// restart mid-incident, but the console recovers between the two initial
	// attempts: attempt 2 fetches a payload byte-identical to the cache. A
	// zero-diff NETWORK generation (tag != nil) is a genuine recovery and must
	// clear held — otherwise the stored Last-Modified tag 304-wedges the held
	// state forever against a sane console
	b := NewBreakerRepositoryData("bulker-connections", BreakerConfig{MaxChangePercent: 50, MinChangedRows: 20}, dir)
	require.Error(t, breakerInitNetwork(b, rowsPayload(100, `{}`)))
	require.True(t, b.Held())
	require.NoError(t, breakerInitNetwork(b, good))
	require.False(t, b.Held(), "network zero-diff recovery must clear held")
}

func TestBreakerRepeatedRejectionShortCircuits(t *testing.T) {
	b := testBreaker()
	good := rowsPayload(100, `{"mode":"batch"}`)
	require.NoError(t, breakerInit(b, good))
	blanked := rowsPayload(100, `{}`)
	require.Error(t, breakerInit(b, blanked))
	// identical rejected generation on retry: still an error, cheap path
	err := breakerInit(b, blanked)
	require.Error(t, err)
	require.Contains(t, err.Error(), "unchanged")
	require.True(t, b.Held())
	// a different (also bad) generation still gets the full check
	require.Error(t, breakerInit(b, rowsPayload(100, `{"x":1}`)))
	require.NotContains(t, b.Status()["reason"], "unchanged")
	// and recovery still works after short-circuits
	require.NoError(t, breakerInit(b, good))
	require.False(t, b.Held())
}

func TestBreakerRowsWithoutIdIgnored(t *testing.T) {
	b := testBreaker()
	payload := `[{"noid":true},` + rowsPayload(30, `{"a":1}`)[1:]
	require.NoError(t, breakerInit(b, payload))
	require.NoError(t, breakerInit(b, `[{"noid":false},`+rowsPayload(30, `{"a":1}`)[1:]))
	require.False(t, b.Held())
}

func TestBreakerRejectsIdCoverageCollapse(t *testing.T) {
	b := testBreaker()
	good := rowsPayload(100, `{"a":1}`)
	require.NoError(t, breakerInit(b, good))

	// every row lost its id: the breaker cannot track such a payload — must
	// reject as invalid, keeping last-known-good
	var idless []string
	for i := 0; i < 100; i++ {
		idless = append(idless, fmt.Sprintf(`{"options":{"a":%d}}`, i))
	}
	err := breakerInit(b, "["+strings.Join(idless, ",")+"]")
	require.Error(t, err)
	require.Contains(t, err.Error(), "no id")
	require.Equal(t, good, string(*b.GetData()))

	// not bypassable by operator accept — it is payload validity, not a threshold
	b.AcceptNext()
	require.Error(t, breakerInit(b, "["+strings.Join(idless, ",")+"]"))

	// cold start (no baseline) must reject it too — accepting would leave the
	// breaker permanently blind
	cold := testBreaker()
	require.Error(t, breakerInit(cold, "["+strings.Join(idless[:50], ",")+"]"))
}
