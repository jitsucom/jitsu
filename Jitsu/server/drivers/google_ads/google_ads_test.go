package google_ads

import (
	"context"
	"github.com/jitsucom/jitsu/server/drivers/base"
	"strings"
	"testing"
)

type intervalTestData struct {
	fields    string
	expected  string
}

var testFields = []intervalTestData{
	{"segments.hour,segments.date,segments.day_of_week,segments.week", "DAY"},
	{"segments.date,segments.day_of_week,segments.week", "DAY"},
	{"segments.week,segments.month", "WEEK"},
	{"segments.month,segments.month_of_year,segments.quarter", "MONTH"},
	{"segments.quarter,segments.year", "QUARTER"},
	{"segments.year", "YEAR"},
	{"metrics.date", "ALL"},
}

//TestAutoIntervals tests automatic interval selection based on provided fields list
func TestAutoIntervals(t *testing.T) {
	for _, tt := range testFields {
		t.Run(tt.fields, func(t *testing.T) {
			test(t, tt)
		})
	}
}

func test(t *testing.T, data intervalTestData) {
	var sourceConfig = base.SourceConfig{SourceID: "GoogleAds", Type: "google_ads"}
	sourceConfig.Config = make(map[string]interface{})
	sourceConfig.Config["customer_id"] = "1234567"
	sourceConfig.Config["developer_token"] = "1234567"
	mp := make(map[string]interface{})
	sourceConfig.Config["auth"] = mp
	mp["type"] = "Service Account"
	mp["service_account_key"] = "{\"test\":\"test\"}"

	var coll = base.Collection{SourceID: "GoogleAds", Type: "campaign" }
	coll.Parameters = make(map[string]interface{})
	coll.Parameters["fields"] = data.fields

 	g, err := NewGoogleAds(context.Background(), &sourceConfig, &coll)
	if err != nil {
		t.Error(err)
		return
	}
	interval, err := g.GetAllAvailableIntervals()
	if err != nil {
		t.Error(err)
		return
	}
	i := interval[0]
	if !strings.Contains(i.String(), data.expected) {
		t.Errorf("Interval: %s but expected: %s", i.String(), data.expected)
		return
	} else {
		t.Logf("Interval: %s from %s to %s", i.String(), i.LowerEndpoint(), i.UpperEndpoint())
	}
}
