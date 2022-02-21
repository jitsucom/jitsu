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
}

//RefillableRateLimiter is a refillable buckets RateLimiter which has capacity and current available value.
//refills (increment by 1) available value every = timeWindow / capacity.
//e.g. capacity = 100, timeWindow = 60 seconds, so every 100/60=1.66 second available value will be incremented by 1
//refill happens on Allow() call
type RefillableRateLimiter struct {
	counterMu                *sync.Mutex
	capacity                 uint64
	incrementallyRefillEvery time.Duration
	available                uint64
	lastRefillTime           time.Time

	oneMinuteSecondsCircleBuffer []*BucketCounter
}

func NewRefillableRateLimiter(capacity uint64, timeWindow time.Duration) RateLimiter {
	//get recharge time for increments
	incrementallyRefillEvery := time.Duration(float64(timeWindow) / math.Max(float64(capacity), 1))

	now := timestamp.Now()
	seconds := int(time.Minute.Seconds())
	oneMinuteSecondsCircleBuffer := make([]*BucketCounter, seconds)
	for i := 0; i < seconds; i++ {
		oneMinuteSecondsCircleBuffer[i] = newBucketCounter(i, now)
	}
	srl := &RefillableRateLimiter{
		counterMu:                    &sync.Mutex{},
		capacity:                     capacity,
		available:                    capacity,
		incrementallyRefillEvery:     incrementallyRefillEvery,
		lastRefillTime:               timestamp.Now().UTC(),
		oneMinuteSecondsCircleBuffer: oneMinuteSecondsCircleBuffer,
	}

	return srl
}

//Allow checks if available > 0 then just decrement and returns true
//if available == 0 checks how much we can refill based on last refill time
//or return false and counts limited
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

//GetLastMinuteLimited returns quantity of limits in the last minute
func (brl *RefillableRateLimiter) GetLastMinuteLimited() uint64 {
	now := timestamp.Now().UTC()

	v := uint64(0)
	for _, oneSecondBucketCounter := range brl.oneMinuteSecondsCircleBuffer {
		v += oneSecondBucketCounter.Get(now)
	}

	return v
}

//countLimited takes limited into account in lastMinuteLimited
func (brl *RefillableRateLimiter) countLimited() {
	now := timestamp.Now().UTC()
	brl.oneMinuteSecondsCircleBuffer[now.Second()].Increment(now)
}
