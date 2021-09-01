package timestamp

import (
	"time"

	"go.uber.org/atomic"
)

var (
	// The value of freezed time that is used in all tests
	freezedTime = time.Date(2020, 06, 16, 23, 0, 0, 0, time.UTC)

	// Indicator shows that time was freezed or was not freezed
	timeFreezed = atomic.NewBool(false)
)

func Now() time.Time {
	if timeFreezed.Load() {
		return freezedTime
	}
	return time.Now()
}

func FreezeTime() {
	timeFreezed.Store(true)
}

func UnfreezeTime() {
	timeFreezed.Store(false)
}
