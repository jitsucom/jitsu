package main

import (
	"runtime"
	"testing"
	"time"
)

// manageBulkerTimeout arms a watchdog around a bulker call and returns the function that disarms it. Disarming has to
// release everything the watchdog started: a goroutine left blocked on a stopped timer is leaked for good, and a long
// sync commits at every checkpoint, for every stream that is due (JITSU-258 review).
func TestBulkerTimeoutReleasesItsGoroutine(t *testing.T) {
	s := &ReadSideCar{AbstractSideCar: &AbstractSideCar{logLevel: "FATAL", dbLogLevel: "FATAL"}}
	before := runtime.NumGoroutine()
	const cycles = 300
	for i := 0; i < cycles; i++ {
		stop := s.manageBulkerTimeout(0) // a commit that finishes long before the deadline
		stop()
	}
	// give any goroutine that is going to exit a moment to do so
	deadline := time.Now().Add(3 * time.Second)
	for runtime.NumGoroutine() > before+10 && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	if after := runtime.NumGoroutine(); after > before+10 {
		t.Fatalf("goroutines: %d before, %d after %d disarmed watchdogs: %d are still blocked", before, after, cycles, after-before)
	}
}
