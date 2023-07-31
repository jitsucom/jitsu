package storages

import (
	"github.com/jitsucom/jitsu/server/timestamp"
	"github.com/stretchr/testify/require"
	"testing"
	"time"
)

func TestFindStartEndTimestamp(t *testing.T) {
	testTime1, _ := time.Parse(timestamp.Layout, "2020-07-02T19:15:59.757719Z")
	testTime2, _ := time.Parse(timestamp.Layout, "2020-07-02T19:20:59.757719Z")
	testTime3, _ := time.Parse(timestamp.Layout, "2020-07-02T19:23:59.757719Z")
	testTime4, _ := time.Parse(timestamp.Layout, "2020-07-03T19:23:59.757719Z")
	tests := []struct {
		name          string
		input         []map[string]interface{}
		expectedStart time.Time
		expectedEnd   time.Time
	}{
		{
			"string input",
			[]map[string]interface{}{
				{timestamp.Key: "2020-07-02T19:16:59.757719Z"},
				{timestamp.Key: "2020-07-02T19:15:59.757719Z"},
				{timestamp.Key: "2020-07-02T19:23:59.757719Z"},
				{timestamp.Key: "2020-07-02T19:20:59.757719Z"},
			},
			testTime1,
			testTime3,
		},
		{
			"time and strings input",
			[]map[string]interface{}{
				{timestamp.Key: testTime3},
				{timestamp.Key: testTime1},
				{timestamp.Key: testTime2},
				{timestamp.Key: "2020-07-03T19:23:59.757719Z"},
			},
			testTime1,
			testTime4,
		},
		{
			"time pointers and time and strings input",
			[]map[string]interface{}{
				{timestamp.Key: testTime3},
				{timestamp.Key: &testTime1},
				{timestamp.Key: "2020-07-02T19:20:59.757719Z"},
			},
			testTime1,
			testTime3,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			actualStart, actualEnd := findStartEndTimestamp(tt.input)
			require.Equal(t, tt.expectedStart, actualStart, "Start dates aren't equal")
			require.Equal(t, tt.expectedEnd, actualEnd, "End dates aren't equal")
		})
	}
}
