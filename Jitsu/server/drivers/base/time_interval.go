package base

import (
	"github.com/jitsucom/jitsu/server/schema"
	"time"
)

const SignatureLayout = "2006-01-02T15:04:05.000Z"

type TimeInterval struct {
	TimeZoneID string

	granularity schema.Granularity
	time        time.Time
}

func NewTimeInterval(granularity schema.Granularity, t time.Time) *TimeInterval {
	return &TimeInterval{
		TimeZoneID:  time.UTC.String(),
		granularity: granularity,
		time:        t,
	}
}

func (ti *TimeInterval) LowerEndpoint() time.Time {
	return ti.granularity.Lower(ti.time)
}

func (ti *TimeInterval) UpperEndpoint() time.Time {
	return ti.granularity.Upper(ti.time)
}

func (ti *TimeInterval) Granularity() schema.Granularity {
	return ti.granularity
}

func (ti *TimeInterval) CalculateSignatureFrom(t time.Time, window time.Duration) string {
	timeWithLag := t.Add(-window)
	if timeWithLag.Before(ti.UpperEndpoint()) {
		return timeWithLag.Format(SignatureLayout)
	} else {
		return ti.UpperEndpoint().Format(SignatureLayout)
	}
}

func (ti *TimeInterval) String() string {
	return ti.TimeZoneID + "_" + ti.granularity.String() + "_" + ti.granularity.Format(ti.time)
}

func (ti *TimeInterval) IsAll() bool {
	return ti.granularity == schema.ALL
}
