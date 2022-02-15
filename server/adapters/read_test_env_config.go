package adapters

import (
	"encoding/json"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/stretchr/testify/require"
	"os"
	"testing"
)

const testRedshiftConfigVar = "TEST_REDSHIFT_CONFIG"

func ReadRedshiftConfig(t *testing.T) (*DataSourceConfig, bool) {
	sfConfigJSON := os.Getenv(testRedshiftConfigVar)
	if sfConfigJSON == "" {
		logging.Errorf("OS var %q configuration isn't set", testRedshiftConfigVar)
		return nil, false
	}
	dsConfig := &DataSourceConfig{}
	err := json.Unmarshal([]byte(sfConfigJSON), dsConfig)
	require.NoError(t, err, "failed to parse redshift config from env")

	return dsConfig, true
}
