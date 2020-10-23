package events

import (
	"github.com/stretchr/testify/require"
	"testing"
)

func TestCachePutGetN(t *testing.T) {
	cache := NewCache(5)
	cache.Put("key1", Fact{"name": "fact1"})
	cache.Put("key1", Fact{"name": "fact2"})
	cache.Put("key1", Fact{"name": "fact3"})
	cache.Put("key1", Fact{"name": "fact4"})

	fourFacts := cache.GetN("key1", 5)
	require.Equal(t, 4, len(fourFacts))
	require.Equal(t, Fact{"name": "fact3"}, fourFacts[2])

	cache.Put("key1", Fact{"name": "fact5"})
	cache.Put("key1", Fact{"name": "fact6"})
	fiveFacts := cache.GetN("key1", 5)
	require.Equal(t, 5, len(fiveFacts))
	require.Equal(t, Fact{"name": "fact5"}, fiveFacts[0])
	require.Equal(t, Fact{"name": "fact2"}, fiveFacts[1])
	require.Equal(t, Fact{"name": "fact6"}, fiveFacts[4])

	cache.Put("key1", Fact{"name": "fact7"})
	cache.Put("key1", Fact{"name": "fact8"})
	cache.Put("key1", Fact{"name": "fact9"})
	cache.Put("key1", Fact{"name": "fact10"})
	otheFiveFacts := cache.GetN("key1", 5)
	require.Equal(t, 5, len(otheFiveFacts))
	require.Equal(t, Fact{"name": "fact9"}, fiveFacts[0])
	require.Equal(t, Fact{"name": "fact6"}, fiveFacts[1])
	require.Equal(t, Fact{"name": "fact10"}, fiveFacts[4])
}
