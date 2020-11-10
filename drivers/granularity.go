package drivers

import (
	"github.com/ksensehq/eventnative/logging"
	"time"
)

type Granularity string

const (
	DAY   Granularity = "DAY"
	MONTH Granularity = "MONTH"
	YEAR  Granularity = "YEAR"
)

func (g Granularity) Lower(t time.Time) time.Time {
	switch g {
	case DAY:
		return t.Truncate(time.Hour * 24)
	case MONTH:
		return time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, t.Location())
	case YEAR:
		return time.Date(t.Year(), 1, 1, 0, 0, 0, 0, t.Location())
	default:
		logging.SystemError("Unknown granularity:", g)
		return time.Time{}
	}
}

func (g Granularity) Upper(t time.Time) time.Time {
	switch g {
	case DAY:
		return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, t.Location()).AddDate(0, 0, 1).Add(-time.Nanosecond)
	case MONTH:
		return time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, t.Location()).AddDate(0, 1, 0).Add(-time.Nanosecond)
	case YEAR:
		return time.Date(t.Year(), 1, 1, 0, 0, 0, 0, t.Location()).AddDate(1, 0, 0).Add(-time.Nanosecond)
	default:
		logging.SystemError("Unknown granularity:", g)
		return time.Time{}
	}
}

func (g Granularity) Format(t time.Time) string {
	switch g {
	case DAY:
		return t.Format("2006-01-01")
	case MONTH:
		return t.Format("2006-01")
	case YEAR:
		return t.Format("2006")
	default:
		logging.SystemError("Unknown granularity:", g)
		return ""
	}
}

func (g Granularity) String() string {
	switch g {
	case DAY:
		return string(DAY)
	case MONTH:
		return string(MONTH)
	case YEAR:
		return string(YEAR)
	default:
		logging.SystemError("Unknown granularity:", g)
		return ""
	}
}
