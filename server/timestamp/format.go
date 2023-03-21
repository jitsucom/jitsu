package timestamp

import "time"

// Key is a default key and format of event timestamp
const Key = "_timestamp"

// Layout is an ISO date time format. Note: for parsing use time.RFC3339Nano.
const Layout = "2006-01-02T15:04:05.000000Z"

// DayLayout is a Day format of time.Time
const DayLayout = "20060102"

// MonthLayout is a Month format of time.Time
const MonthLayout = "200601"

// DashDayLayout is a Day format with dash delimiter of time.Time
const DashDayLayout = "2006-01-02"

// LogsLayout is a date time representation for log records prefixes
const LogsLayout = "2006-01-02 15:04:05"

// GolangLayout is a default golang layout that is returned on String() without formatting
const GolangLayout = "2006-01-02T15:04:05+0000"

// DBLayout is a time layout that usually comes from Airbyte database sources
const DBLayout = "2006-01-02T15:04:05.000000"

// NowUTC returns ISO string representation of current UTC time
func NowUTC() string {
	return Now().UTC().Format(Layout)
}

// ToISOFormat returns ISO string representation of input time.Time
func ToISOFormat(t time.Time) string {
	return t.Format(Layout)
}

// ParseISOFormat returns time.Time from ISO time string representation
func ParseISOFormat(t string) (time.Time, error) {
	return time.Parse(Layout, t)
}
