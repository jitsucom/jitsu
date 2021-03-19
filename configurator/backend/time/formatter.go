package time

import "time"

const ISOLayout = "2006-01-02T15:04:05.000Z"

func AsISOString(t time.Time) string {

	return t.Format(ISOLayout)
}

func ParseISOString(dateString string) (time.Time, error) {
	return time.Parse(ISOLayout, dateString)
}
