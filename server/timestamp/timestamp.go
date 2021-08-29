package timestamp

import "time"

var (
	// The value of freezed time that is used in all tests
	freezedTime = time.Date(2020, 06, 16, 23, 0, 0, 0, time.UTC)

	// Indicator shows that time was freezed or was not freezed
	timeFreezed = false
)

func Now() time.Time {
	if timeFreezed {
		return freezedTime
	}
	return time.Now()
}

func FreezeTime() {
	timeFreezed = true
}

func UnfreezeTime() {
	timeFreezed = false
}
