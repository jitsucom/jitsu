package storages

import (
	"github.com/stretchr/testify/require"
	"testing"
)

func TestLinesCount(t *testing.T) {
	tests := []struct {
		name     string
		input    []byte
		expected int
	}{
		{
			"empty input",
			[]byte(""),
			0,
		},
		{
			"one line",
			[]byte("abcbdsahbda"),
			1,
		},
		{
			"one line with \\n",
			[]byte("abcbdsahbda\n"),
			1,
		},
		{
			"two lines",
			[]byte("abcbdsahbda\n123"),
			2,
		},
		{
			"five lines",
			[]byte("abcbdsahbda\n123\ndsandoas\ndasda\n1"),
			5,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			actualRowsCount := linesCount(tt.input)
			require.Equal(t, tt.expected, actualRowsCount, "Rows counts aren't equal")
		})
	}
}
