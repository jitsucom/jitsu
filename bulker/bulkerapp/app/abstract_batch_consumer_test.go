package app

import (
	"testing"

	"github.com/confluentinc/confluent-kafka-go/v2/kafka"
	"github.com/stretchr/testify/assert"
)

func TestHasLag(t *testing.T) {
	testCases := []struct {
		desc      string
		committed int64
		high      int64
		expected  bool
	}{
		{"empty topic, nothing committed", int64(kafka.OffsetBeginning), 0, false},
		{"empty topic, stale commit", 10, 0, false},
		{"messages but no committed offset (new topic or deleted group)", int64(kafka.OffsetBeginning), 262_072, true},
		{"committed behind the watermark", 100, 150, true},
		{"fully consumed", 150, 150, false},
	}
	for _, tc := range testCases {
		t.Run(tc.desc, func(t *testing.T) {
			assert.Equal(t, tc.expected, hasLag(tc.committed, tc.high))
		})
	}
}

func TestMembershipLossReason(t *testing.T) {
	testCases := []struct {
		desc     string
		err      kafka.Error
		lost     bool
		contains string
	}{
		{"max.poll.interval exceeded", kafka.NewError(kafka.ErrMaxPollExceeded, "Application maximum poll interval (300000ms) exceeded", false), true, "max.poll.interval"},
		{"fenced static instance (broker)", kafka.NewError(kafka.ErrFencedInstanceID, "Static consumer fenced by other consumer with same group.instance.id", true), true, "fenced"},
		{"fenced (local)", kafka.NewError(kafka.ErrFenced, "fenced", true), true, "fenced"},
		{"unknown member", kafka.NewError(kafka.ErrUnknownMemberID, "Unknown member", false), true, "member"},
		{"any fatal error", kafka.NewError(kafka.ErrFatal, "fatal", true), true, "fatal"},
		{"timeout is not a membership loss", kafka.NewError(kafka.ErrTimedOut, "timed out", false), false, ""},
		{"transient broker error is not a membership loss", kafka.NewError(kafka.ErrTransport, "transport", false), false, ""},
	}
	for _, tc := range testCases {
		t.Run(tc.desc, func(t *testing.T) {
			reason := membershipLossReason(tc.err)
			assert.Equal(t, tc.lost, reason != "")
			if tc.contains != "" {
				assert.Contains(t, reason, tc.contains)
			}
		})
	}
}
