package coordination

import (
	"testing"
	"time"

	"github.com/jitsucom/jitsu/server/telemetry"
	"github.com/stretchr/testify/require"
)

func TestIncrementVersion(t *testing.T) {
	telemetry.InitTest()
	ims := NewInMemoryService([]string{"instance1"})

	go func() {
		for i := 0; i < 10000; i++ {
			ims.GetVersion("system1", "collection1")
			ims.IncrementVersion("system1", "collection1")

			ims.IncrementVersion("system2", "collection2")
			ims.GetVersion("system2", "collection2")
		}
	}()

	go func() {
		for i := 0; i < 4000; i++ {
			ims.IncrementVersion("system2", "collection2")
			ims.GetVersion("system2", "collection2")

			ims.GetVersion("system1", "collection1")
			ims.IncrementVersion("system1", "collection1")
		}
	}()

	time.Sleep(1 * time.Second)

	version1, err1 := ims.GetVersion("system1", "collection1")
	require.NoError(t, err1)
	require.Equal(t, version1, int64(14000))

	version2, err2 := ims.GetVersion("system2", "collection2")
	require.NoError(t, err2)
	require.Equal(t, version2, int64(14000))
}
