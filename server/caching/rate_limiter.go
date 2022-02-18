package caching

import (
	"github.com/jitsucom/jitsu/server/timestamp"
	"math"
	"sync"
	"time"
)

type RateLimiter interface {
	Allow() bool
	GetLastMinuteLimited() uint64
	Close() error
}

//RefillableRateLimiter is a RateLimiter which has underlying goroutine for refill current allowance level
//the goroutine increments available value every incrementallyRefillEvery time.
type RefillableRateLimiter struct {
	counterMu                *sync.Mutex
	doneOnce                 *sync.Once
	closed                   chan struct{}
	capacity                 uint64
	incrementallyRefillEvery time.Duration

	available      uint64
	lastRefillTime time.Time

	lastLimitedMu     *sync.Mutex
	lastLimitedTime   time.Time
	lastMinuteLimited []uint64
}

func NewRateLimiter(capacity uint64, timeWindowSeconds time.Duration) *RefillableRateLimiter {
	//get recharge time for increments
	incrementallyRefillEvery := time.Duration(float64(timeWindowSeconds) / math.Max(float64(capacity), 1))
	srl := &RefillableRateLimiter{
		counterMu:                &sync.Mutex{},
		doneOnce:                 &sync.Once{},
		closed:                   make(chan struct{}),
		capacity:                 capacity,
		available:                capacity,
		incrementallyRefillEvery: incrementallyRefillEvery,

		lastRefillTime: timestamp.Now().UTC(),

		lastLimitedMu:     &sync.Mutex{},
		lastLimitedTime:   timestamp.Now().UTC(),
		lastMinuteLimited: make([]uint64, 60, 60),
	}

	return srl
}

func (brl *RefillableRateLimiter) Allow() bool {
	brl.counterMu.Lock()
	defer brl.counterMu.Unlock()

	if brl.available > 0 {
		brl.available--
		return true
	}

	now := timestamp.Now().UTC()
	refilled := uint64(now.Sub(brl.lastRefillTime) / brl.incrementallyRefillEvery)
	if refilled > 0 {
		if refilled > brl.capacity {
			refilled = brl.capacity
		}
		//set available minus 1: current allowing
		brl.available += refilled - 1
		brl.lastRefillTime = now
		return true
	} else {
		brl.countLimited()
		return false
	}
}

func (brl *RefillableRateLimiter) GetLastMinuteLimited() uint64 {
	brl.lastLimitedMu.Lock()
	defer brl.lastLimitedMu.Unlock()

	now := timestamp.Now().UTC()
	if now.Sub(brl.lastLimitedTime).Seconds() > time.Minute.Seconds() {
		//cut all values because there was another time window
		brl.lastMinuteLimited = make([]uint64, 60, 60)
		return 0
	}

	v := uint64(0)
	for _, secondCounter := range brl.lastMinuteLimited {
		v += secondCounter
	}

	return v
}

func (brl *RefillableRateLimiter) countLimited() {
	brl.lastLimitedMu.Lock()
	defer brl.lastLimitedMu.Unlock()

	now := timestamp.Now().UTC()
	if now.Sub(brl.lastLimitedTime).Seconds() > time.Minute.Seconds() {
		//cut all values because there was another time window
		brl.lastMinuteLimited = make([]uint64, 60, 60)
	}

	brl.lastMinuteLimited[now.Second()] += 1
	brl.lastLimitedTime = now
}

func (brl *RefillableRateLimiter) Close() error {
	brl.doneOnce.Do(func() {
		close(brl.closed)
	})

	return nil
}
