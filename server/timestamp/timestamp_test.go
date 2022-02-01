package timestamp

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestFreezing(t *testing.T) {

	require.NotEqual(t, frozenTime, Now(), "Now() should provide real current time")

	FreezeTime()

	require.Equal(t, frozenTime, Now(), "Now() should provide freezed time after freezing")

	UnfreezeTime()

	require.NotEqual(t, frozenTime, Now(), "Now() should provide real time after unfreezing")
}
