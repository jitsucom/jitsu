package main

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"hash"
	"hash/fnv"
	"io"
	"os"
	"path"
	"sort"
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

	// acceptArmedUntil: operator pre-arm expiry. A pre-armed accept must not
	// linger indefinitely — an accept armed for a planned deploy that then
	// doesn't happen would silently bypass a real incident later. now() is a
	// field for tests
	acceptArmedUntil atomic.Pointer[time.Time]
	now              func() time.Time
	held             atomic.Bool
	heldSince        atomic.Pointer[time.Time]
	tripReason       atomic.Pointer[string]
}

func NewBreakerRepositoryData(name string, cfg BreakerConfig, cacheDir string) *BreakerRepositoryData {
	b := &BreakerRepositoryData{name: name, cfg: cfg, now: time.Now}
	setBreakerHeld(name, false)
	if cacheDir != "" {
		if data, err := os.ReadFile(path.Join(cacheDir, name)); err == nil {
			if hashes, _, err := hashRows(data); err == nil {
				b.baseline = hashes
				recordRepositoryRows(name, data)
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
	if b.held.Load() && !b.acceptArmed() {
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
	hashes, noId, err := hashRows(data)
	if err != nil {
		// repositories guarded by the breaker are JSON arrays by contract —
		// an unparseable payload must never replace a good one
		return b.reject(fmt.Sprintf("payload is not a valid JSON array: %v", err))
	}
	// guarded repositories carry an `id` on every row by contract. A payload
	// where the id-less share exceeds MaxRemovePercent is treated as invalid —
	// NOT bypassable by an armed accept, and deliberately WITHOUT the
	// MinChangedRows floor: the floor exists for legitimate churn, but an
	// id-less majority is a contract violation at any fleet size, and
	// accepting one would collapse the baseline and blind the breaker. A
	// minority of odd rows stays tolerated so one junk row can't wedge
	// refreshes
	if total := noId + len(hashes); total > 0 && noId > 0 && float64(noId)/float64(total)*100 > b.cfg.MaxRemovePercent {
		return b.reject(fmt.Sprintf("%d of %d rows have no id — refusing a payload the breaker cannot track", noId, total))
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	changed, common := diffRows(b.baseline, hashes)
	if len(b.baseline) > 0 && !b.acceptArmed() {
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
			setBreakerHeld(b.name, true)
			b.alertLocked(transition, fmt.Sprintf("tripped, keeping last-known-good payload: %s. "+
				"If this mass change is intended, confirm it with POST /breaker/%s/accept (per replica)", reason, b.name))
			b.lastRejected = payloadHash
			return fmt.Errorf("circuit breaker: %s", reason)
		}
	}
	if b.consumeAccept() {
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
		recordRepositoryRows(b.name, data)
		return nil
	}
	b.baseline = hashes
	b.lastRejected = 0
	// a fresh rejection after an accepted generation must alert immediately
	// again — applies to validity rejections too, which never set held
	b.lastTripLog = time.Time{}
	if b.held.Swap(false) {
		b.heldSince.Store(nil)
		b.tripReason.Store(nil)
		setBreakerHeld(b.name, false)
		logging.Infof("[%s] repository circuit breaker recovered: new generation accepted", b.name)
	}
	b.raw.data.Store(&data)
	recordRepositoryRows(b.name, data)
	return nil
}

// reject is the validity-rejection path (unparseable payload, id-coverage
// collapse): the payload is refused before any diff, so it neither trips nor
// sets held — but it IS the breaker keeping last-known-good against a broken
// console, and must page like a trip does
func (b *BreakerRepositoryData) reject(reason string) error {
	b.mu.Lock()
	b.alertLocked(false, "payload rejected, keeping last-known-good payload: "+reason)
	b.mu.Unlock()
	return fmt.Errorf("circuit breaker: %s", reason)
}

// alertLocked emits the "System error:" log (the marker log-based alerting
// hooks on) — on a forced transition and otherwise at most once a minute, not
// on every rejection: the framework retries immediately and then every poll,
// and a console may regenerate a byte-varying bad payload each time. Caller
// holds mu
func (b *BreakerRepositoryData) alertLocked(force bool, msg string) {
	if force || time.Since(b.lastTripLog) > time.Minute {
		logging.SystemErrorf("[%s] repository circuit breaker %s", b.name, msg)
		b.lastTripLog = time.Now()
	}
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
// acceptTTL bounds a pre-armed accept: long enough to arm before a planned
// deploy, short enough that a forgotten arm can't bypass a future incident
const acceptTTL = 15 * time.Minute

func (b *BreakerRepositoryData) AcceptNext() time.Time {
	until := b.now().Add(acceptTTL)
	b.acceptArmedUntil.Store(&until)
	return until
}

func (b *BreakerRepositoryData) acceptArmed() bool {
	t := b.acceptArmedUntil.Load()
	return t != nil && b.now().Before(*t)
}

// consumeAccept reports whether an unexpired arm was present, and disarms
func (b *BreakerRepositoryData) consumeAccept() bool {
	t := b.acceptArmedUntil.Swap(nil)
	return t != nil && b.now().Before(*t)
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
// Rows are hashed CANONICALLY (object keys sorted, structure-tagged), not by
// raw bytes: a console deploy that merely changes row serialization (key
// order) must not read as a fleet-wide mass change. That exact false positive
// tripped the breaker on every guarded repo the day it shipped (jitsu#1478's
// zod parse reordering keys, 2026-08-24). Numbers hash by their literal (via
// json.Number), so value precision is preserved; the producer is always the
// console's JSON.stringify, so literal formatting is stable across refreshes.
func hashRows(payload []byte) (hashes map[string]uint64, noId int, err error) {
	var rows []json.RawMessage
	if err = json.Unmarshal(payload, &rows); err != nil {
		return nil, 0, err
	}
	hashes = make(map[string]uint64, len(rows))
	for _, row := range rows {
		dec := json.NewDecoder(bytes.NewReader(row))
		dec.UseNumber()
		var obj map[string]any
		if err := dec.Decode(&obj); err != nil {
			noId++
			continue
		}
		id, _ := obj["id"].(string)
		if id == "" {
			noId++
			continue
		}
		h := fnv.New64a()
		writeCanonical(h, obj)
		hashes[id] = h.Sum64()
	}
	return hashes, noId, nil
}

// writeCanonical feeds a decoded JSON value into the hasher in a
// deterministic, structure-tagged form: object keys sorted, strings
// length-prefixed (so {"a":"bc"} and {"ab":"c"} cannot collide), values
// tagged by type.
func writeCanonical(h hash.Hash64, v any) {
	switch t := v.(type) {
	case map[string]any:
		_, _ = h.Write([]byte{'{'})
		keys := make([]string, 0, len(t))
		for k := range t {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			// separator makes the encoding uniquely decodable: without it the
			// object-close '}' can collide with the first byte of a key's
			// length prefix (reviewer-constructed collision, pathological keys)
			_, _ = h.Write([]byte{','})
			writeCanonicalString(h, k)
			_, _ = h.Write([]byte{':'})
			writeCanonical(h, t[k])
		}
		_, _ = h.Write([]byte{'}'})
	case []any:
		_, _ = h.Write([]byte{'['})
		for _, e := range t {
			writeCanonical(h, e)
			_, _ = h.Write([]byte{','})
		}
		_, _ = h.Write([]byte{']'})
	case string:
		_, _ = h.Write([]byte{'s'})
		writeCanonicalString(h, t)
	case json.Number:
		_, _ = h.Write([]byte{'#'})
		writeCanonicalString(h, t.String())
	case bool:
		if t {
			_, _ = h.Write([]byte{'T'})
		} else {
			_, _ = h.Write([]byte{'F'})
		}
	default: // nil
		_, _ = h.Write([]byte{'N'})
	}
}

func writeCanonicalString(h hash.Hash64, s string) {
	var lenBuf [8]byte
	binary.LittleEndian.PutUint64(lenBuf[:], uint64(len(s)))
	_, _ = h.Write(lenBuf[:])
	_, _ = io.WriteString(h, s)
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
