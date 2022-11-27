package useragent

import (
	"github.com/jitsucom/jitsu/server/test"
	"testing"
)

func TestResolve(t *testing.T) {
	tests := []struct {
		name     string
		inputUa  string
		expected *ResolvedUa
	}{
		{
			"Empty ua",
			"",
			nil,
		},
		{
			"Wrong format ua",
			"some wrong format ua 123",
			nil,
		},
		{
			"Ok resolved ua from device",
			"Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10_6_3; en-us; Silk/1.1.0-80) AppleWebKit/533.16 (KHTML, like Gecko) Version/5.0 Safari/533.16 Silk-Accelerated=true",
			&ResolvedUa{UaFamily: "Amazon Silk", UaVersion: "1.1.0-80", OsFamily: "Android", DeviceFamily: "Kindle", DeviceBrand: "Amazon", DeviceModel: "Kindle"},
		},
		{
			"Ok resolved ua from browser",
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.116 Safari/537.36",
			&ResolvedUa{UaFamily: "Chrome", UaVersion: "83.0.4103", OsFamily: "Mac OS X", OsVersion: "10.15.5", DeviceFamily: "Mac", DeviceBrand: "Apple", DeviceModel: "Mac"},
		},
	}
	uaResolver := NewResolver([]string{})
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			test.ObjectsEqual(t, tt.expected, uaResolver.Resolve(tt.inputUa), "Resolved user agents aren't equal")
		})
	}
}
