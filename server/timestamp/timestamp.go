package timestamp

import (
	"time"

	"go.uber.org/atomic"
)

var (
	// The value of frozen time that is used in all tests
	frozenTime = time.Date(2020, 06, 16, 23, 0, 0, 0, time.UTC)

	// Indicator shows that time was frozen or was not frozen
	timeFrozen = atomic.NewBool(false)
)

func Now() time.Time {
	if timeFrozen.Load() {
		return frozenTime
	}
	return time.Now()
}

func FreezeTime() {
	timeFrozen.Store(true)
}

func UnfreezeTime() {
	timeFrozen.Store(false)
}
