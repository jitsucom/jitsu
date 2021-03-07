package timestamp

import "time"

//default key and format of event timestamp
const Key = "_timestamp"
const Layout = "2006-01-02T15:04:05.000000Z"
const DayLayout = "20060102"
const MonthLayout = "200601"
const DashDayLayout = "2006-01-02"
const LogsLayout = "2006-01-02 15:04:05"

//TODO delete
const DeprecatedLayout = "2006-01-02T15:04:05.000Z"

func NowUTC() string {
	return time.Now().UTC().Format(Layout)
}

func ToISOFormat(t time.Time) string {
	return t.Format(Layout)
}
