package adapters

import (
	"encoding/json"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/stretchr/testify/require"
	"os"
	"testing"
)

const (
	testRedshiftConfigVar = "TEST_REDSHIFT_CONFIG"
	testSFConfigVar       = "TEST_SF_CONFIG"
)

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

func ReadSFConfig(t *testing.T) (*SnowflakeConfig, bool) {
	sfConfigJSON := os.Getenv(testSFConfigVar)
	if sfConfigJSON == "" {
		logging.Errorf("OS var %q configuration doesn't exist", testSFConfigVar)
		return nil, false
	}
	sfConfig := &SnowflakeConfig{}
	err := json.Unmarshal([]byte(sfConfigJSON), sfConfig)
	require.NoError(t, err)

	return sfConfig, true
}
