package caching

import (
	"sync"
	"time"
)

//BucketCounter is a counter of a certain second
type BucketCounter struct {
	mu *sync.RWMutex

	secondsID     int
	v             uint64
	currentMinute time.Time
}

//newBucketCounter returns configured BucketCounter of the certain second
func newBucketCounter(secondsID int, now time.Time) *BucketCounter {
	return &BucketCounter{
		mu:            &sync.RWMutex{},
		secondsID:     secondsID,
		v:             0,
		currentMinute: now.Truncate(time.Minute),
	}
}

//Increment increments value if now.Minute is equal current minute
//clean counter if the current minute has been changed
func (bc *BucketCounter) Increment(now time.Time) {
	bc.mu.Lock()
	defer bc.mu.Unlock()

	nowMinute := now.Truncate(time.Minute)
	if bc.currentMinute == nowMinute {
		bc.v += 1
	} else {
		bc.v = 1
		bc.currentMinute = nowMinute
	}
}

//Get returns current value if it is a current minute or if secondsID in the last minute interval
func (bc *BucketCounter) Get(now time.Time) uint64 {
	bc.mu.RLock()
	defer bc.mu.RUnlock()

	nowMinute := now.Truncate(time.Minute)
	//current minute or next minute and current secondsID is in the last minute interval
	if bc.currentMinute == nowMinute || (bc.currentMinute.Add(time.Minute) == nowMinute && bc.secondsID > now.Second()) {
		return bc.v
	}

	return 0
}
