package timestamp

import (
	"time"

	"go.uber.org/atomic"
)

var (
	// The value of frozen time that is used in all tests
	frozenTime = time.Date(2020, 06, 16, 23, 0, 0, 0, time.UTC)

	// The value for overwriting in tests
	currentFrozenTime = frozenTime

	// Indicator shows that time was frozen or was not frozen
	timeFrozen = atomic.NewBool(false)
)

func Now() time.Time {
	if timeFrozen.Load() {
		return currentFrozenTime
	}
	return time.Now()
}

func FreezeTime() {
	timeFrozen.Store(true)
}

func SetFreezeTime(t time.Time) {
	currentFrozenTime = t
}

func UnfreezeTime() {
	timeFrozen.Store(false)
	currentFrozenTime = frozenTime
}
