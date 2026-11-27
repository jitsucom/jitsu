package kafkabase

import (
	"os"
	"path/filepath"
	"testing"
	"testing/synctest"

	"github.com/stretchr/testify/require"
)

func TestFailoverArchivesRetainEveryRotationInOneSecond(t *testing.T) {
	dir := t.TempDir()
	synctest.Test(t, func(t *testing.T) {
		// A new process using the same directory and archive prefix must also
		// allocate a fresh basename. The fake clock stays fixed throughout.
		for _, payloads := range [][]string{{"first", "second"}, {"third"}} {
			logger, err := NewFailoverLogger(&FailoverLoggerConfig{Enabled: true, BasePath: dir})
			require.NoError(t, err)
			for _, payload := range payloads {
				require.NoError(t, logger.LogPayload([]byte(payload)))
				require.NoError(t, logger.rotate())
			}
			require.NoError(t, logger.Close())
		}
	})
	archives, err := filepath.Glob(filepath.Join(dir, "*.ndjson"))
	require.NoError(t, err)
	var contents []string
	for _, path := range archives {
		data, err := os.ReadFile(path)
		require.NoError(t, err)
		contents = append(contents, string(data))
	}
	require.ElementsMatch(t, []string{"first\n", "second\n", "third\n"}, contents)
}
