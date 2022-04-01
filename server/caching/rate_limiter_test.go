package caching

import (
	"github.com/jitsucom/jitsu/server/timestamp"
	"github.com/stretchr/testify/require"
	"testing"
	"time"
)

//TestRefillableRateLimiter uses all capacity of allow() in the first second of Minute#0
//check that allow() in next 60 calls will return false
//adds 1 second and check that 1 call of allow() returns true
//ads 59 seconds for moving to Minute#1 and check how many were limited in the last minute
func TestRefillableRateLimiter(t *testing.T) {
	timestamp.FreezeTime()
	defer timestamp.UnfreezeTime()

	rateLimiter := NewRefillableRateLimiter(60, time.Second*60)

	//Minute #0 second#0
	//limit 60 times per minute
	for i := 0; i < 60; i++ {
		require.True(t, rateLimiter.Allow())
	}
	require.Equal(t, uint64(0), rateLimiter.GetLastMinuteLimited())

	//check that allow now return false in Minute#0 second#0
	for i := 0; i < 60; i++ {
		require.False(t, rateLimiter.Allow(), "i=%d", i)
	}
	require.Equal(t, uint64(60), rateLimiter.GetLastMinuteLimited())

	//check allow and limited count in Minute#0 second#1
	timestamp.SetFreezeTime(timestamp.Now().Add(time.Second))
	require.True(t, rateLimiter.Allow())
	//two calls which will be accounted in Minute#0 second#1
	require.False(t, rateLimiter.Allow())
	require.False(t, rateLimiter.Allow())

	//check the result in Minute#1 second#0
	timestamp.SetFreezeTime(timestamp.Now().Add(59 * time.Second))
	require.Equal(t, uint64(2), rateLimiter.GetLastMinuteLimited())

	//check the result in Minute#1 second#1
	timestamp.SetFreezeTime(timestamp.Now().Add(time.Second))
	require.Equal(t, uint64(0), rateLimiter.GetLastMinuteLimited())
}
