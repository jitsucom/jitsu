package main

import (
	"encoding/json"
	"fmt"
	"hash/fnv"
	"io"
	"os"
	"path"
	"sync"
	"sync/atomic"
	"time"

	"github.com/jitsucom/bulker/jitsubase/logging"
)

// Repository payload circuit breaker (JITSU-182, 2026-07-30 postmortem): a
// console bug once served every connection with blank options, and consumers
// applied it fleet-wide within one refresh period. This RepositoryData
// implementation validates each new payload generation against the previously
// accepted one and REJECTS refreshes that materially change too many rows at
// once. Returning an error from Init makes appbase.AbstractRepository keep the
// last-known-good payload and retry on the next poll — the trip needs no
// framework support and every config-keeper consumer is protected at once.
//
// Recovery from a held state:
//   - the console starts serving a sane payload again (self-heals), or
//   - an operator confirms an intended mass change: POST /breaker/{repository}/accept, or
//   - CFGKPR_BREAKER_ENABLED=false (global off switch).
//
// A pod restart cannot bypass the breaker: the baseline is seeded from the
// on-disk cache of the last accepted payload, so a fresh process compares the
// first fetched generation against pre-restart state.

type BreakerConfig struct {
	// MaxChangePercent: reject a refresh when more than this percentage of the
	// rows present in both generations changed at once
	MaxChangePercent float64
	// MaxRemovePercent: reject a refresh when more than this percentage of the
	// baseline's rows disappeared at once — a console bug that filters rows
	// out (broken join, runaway skip-and-log) is as destructive as blanking
	// them: consumers drop those connections and traffic dead-letters
	MaxRemovePercent float64
	// MinChangedRows: never trip below this many changed (or removed) rows —
	// small fleets and bulk edits/cleanups of a handful of rows must not trip
	MinChangedRows int
}

type BreakerRepositoryData struct {
	raw  RawRepositoryData
	name string
	cfg  BreakerConfig

	mu sync.Mutex
	// baseline: row id → content hash of the last accepted generation
	baseline map[string]uint64
	// lastRejected: whole-payload hash of the last rejected generation —
	// short-circuits the framework's immediate retry (attempts=2 re-fetches the
	// same payload) and suppresses duplicate alert logs while held
	lastRejected uint64
	lastTripLog  time.Time

	acceptNext atomic.Bool
	held       atomic.Bool
	heldSince  atomic.Pointer[time.Time]
	tripReason atomic.Pointer[string]
}

func NewBreakerRepositoryData(name string, cfg BreakerConfig, cacheDir string) *BreakerRepositoryData {
	b := &BreakerRepositoryData{name: name, cfg: cfg}
	if cacheDir != "" {
		if data, err := os.ReadFile(path.Join(cacheDir, name)); err == nil {
			if hashes, err := hashRows(data); err == nil {
				b.baseline = hashes
				logging.Infof("[%s] repository circuit breaker baseline seeded from cache: %d rows", name, len(hashes))
			}
		}
	}
	return b
}

func (b *BreakerRepositoryData) Init(reader io.Reader, tag any) error {
	data, err := io.ReadAll(reader)
	if err != nil {
		return err
	}
	payloadHash := hashBytes(data)
	if b.held.Load() && !b.acceptNext.Load() {
		b.mu.Lock()
		sameRejected := payloadHash == b.lastRejected
		b.mu.Unlock()
		if sameRejected {
			// the framework retries immediately (attempts=2) and then every
			// poll — don't re-parse or re-alert for a byte-identical rejected
			// generation
			return fmt.Errorf("circuit breaker: held, rejected generation unchanged")
		}
	}
	hashes, err := hashRows(data)
	if err != nil {
		// repositories guarded by the breaker are JSON arrays by contract —
		// an unparseable payload must never replace a good one
		return fmt.Errorf("[%s] payload is not a valid JSON array: %v", b.name, err)
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	changed, common := diffRows(b.baseline, hashes)
	if len(b.baseline) > 0 && !b.acceptNext.Load() {
		pct := 0.0
		if common > 0 {
			pct = float64(changed) / float64(common) * 100
		}
		removed := len(b.baseline) - common
		removedPct := float64(removed) / float64(len(b.baseline)) * 100
		var reason string
		if changed >= b.cfg.MinChangedRows && pct > b.cfg.MaxChangePercent {
			reason = fmt.Sprintf("%d of %d common rows (%.1f%%) changed in one refresh (threshold: >%.1f%% and >=%d rows)",
				changed, common, pct, b.cfg.MaxChangePercent, b.cfg.MinChangedRows)
		} else if removed >= b.cfg.MinChangedRows && removedPct > b.cfg.MaxRemovePercent {
			reason = fmt.Sprintf("%d of %d baseline rows (%.1f%%) removed in one refresh (threshold: >%.1f%% and >=%d rows)",
				removed, len(b.baseline), removedPct, b.cfg.MaxRemovePercent, b.cfg.MinChangedRows)
		}
		if reason != "" {
			transition := b.held.CompareAndSwap(false, true)
			if transition {
				now := time.Now()
				b.heldSince.Store(&now)
			}
			b.tripReason.Store(&reason)
			// alert on the trip transition and then at most once a minute — not
			// on every rejection, and not per byte-varying regeneration of the
			// same bad payload. "System error:" is the marker log-based
			// alerting hooks on
			if transition || time.Since(b.lastTripLog) > time.Minute {
				logging.Errorf("System error: [%s] repository circuit breaker tripped, keeping last-known-good payload: %s. "+
					"If this mass change is intended, confirm it with POST /breaker/%s/accept (per replica)", b.name, reason, b.name)
				b.lastTripLog = time.Now()
			}
			b.lastRejected = payloadHash
			return fmt.Errorf("circuit breaker: %s", reason)
		}
	}
	if b.acceptNext.Swap(false) {
		logging.Infof("[%s] repository circuit breaker: operator accepted the pending generation (%d rows)", b.name, len(hashes))
	}
	// bootstrap replay: when the first network fetch after a restart trips, the
	// framework falls back to the on-disk cache — the very bytes the baseline
	// was seeded from (zero diff, nothing served yet). That is not a recovery:
	// serve the cached payload but keep the held state and its reason.
	// tag == nil distinguishes loadCached (always passes nil) from a network
	// fetch — a zero-diff NETWORK payload is a genuine recovery and must take
	// the normal held-clearing path below, or the stored Last-Modified tag
	// would 304-wedge the held state forever against a sane console
	if tag == nil && b.held.Load() && b.raw.GetData() == nil && changed == 0 && common == len(hashes) {
		b.raw.data.Store(&data)
		return nil
	}
	b.baseline = hashes
	b.lastRejected = 0
	if b.held.Swap(false) {
		b.heldSince.Store(nil)
		b.tripReason.Store(nil)
		// a fresh trip after this recovery must alert immediately again
		b.lastTripLog = time.Time{}
		logging.Infof("[%s] repository circuit breaker recovered: new generation accepted", b.name)
	}
	b.raw.data.Store(&data)
	return nil
}

func hashBytes(data []byte) uint64 {
	h := fnv.New64a()
	_, _ = h.Write(data)
	return h.Sum64()
}

func (b *BreakerRepositoryData) GetData() *[]byte {
	return b.raw.GetData()
}

func (b *BreakerRepositoryData) Store(writer io.Writer) error {
	return b.raw.Store(writer)
}

// AcceptNext makes the breaker accept the next generation unconditionally —
// the operator's confirmation path for intended mass changes
func (b *BreakerRepositoryData) AcceptNext() {
	b.acceptNext.Store(true)
}

func (b *BreakerRepositoryData) Held() bool {
	return b.held.Load()
}

func (b *BreakerRepositoryData) Status() map[string]any {
	// mu gives a consistent held/heldSince/reason snapshot vs a concurrent
	// Init clearing them mid-read
	b.mu.Lock()
	defer b.mu.Unlock()
	if !b.held.Load() {
		return nil
	}
	status := map[string]any{"held": true}
	if t := b.heldSince.Load(); t != nil {
		status["heldSince"] = t.Format(time.RFC3339)
	}
	if r := b.tripReason.Load(); r != nil {
		status["reason"] = *r
	}
	return status
}

// hashRows parses a repository payload (JSON array of objects) into a map of
// row id → content hash. Rows without a string `id` are ignored for breaker
// purposes (they can neither trip nor suppress it); duplicate ids collapse to
// the last occurrence.
//
// Hashing raw row bytes (not canonicalized JSON) is a deliberate trade-off: a
// console deploy that changes row serialization (key order, materialized
// defaults) without semantic changes reads as a mass change and trips the
// breaker. That is the operator-confirmation case — such deploys are rare,
// fleet-wide, and exactly when a human should be watching; canonicalizing
// every row on every refresh isn't worth dodging that one confirmation
func hashRows(payload []byte) (map[string]uint64, error) {
	var rows []json.RawMessage
	if err := json.Unmarshal(payload, &rows); err != nil {
		return nil, err
	}
	hashes := make(map[string]uint64, len(rows))
	for _, row := range rows {
		var idHolder struct {
			Id string `json:"id"`
		}
		if err := json.Unmarshal(row, &idHolder); err != nil || idHolder.Id == "" {
			continue
		}
		h := fnv.New64a()
		_, _ = h.Write(row)
		hashes[idHolder.Id] = h.Sum64()
	}
	return hashes, nil
}

// diffRows counts rows present in both generations (common) and how many of
// them changed. Added/removed rows deliberately don't count: bulk onboarding
// and cleanup are legitimate, and the incident signature is mass modification
func diffRows(old, updated map[string]uint64) (changed, common int) {
	for id, h := range updated {
		if oldHash, ok := old[id]; ok {
			common++
			if oldHash != h {
				changed++
			}
		}
	}
	return
}
