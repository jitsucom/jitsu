package app

import (
	"testing"

	"github.com/jitsucom/bulker/bulkerapp/metrics"
	"github.com/prometheus/client_golang/prometheus/testutil"
	"github.com/stretchr/testify/require"
)

// The live repository-size gauge (JITSU-191) must equal the number of
// destinations the repository loaded, and drop when destinations disappear.
func TestRepositoryDestinationsCurrentGauge(t *testing.T) {
	src, err := NewYamlConfigurationSource([]byte("destinations:\n  d1: {}\n  d2: {}\n  d3: {}\n"))
	require.NoError(t, err)
	_, err = NewRepository(nil, src)
	require.NoError(t, err)
	require.Equal(t, 3.0, testutil.ToFloat64(metrics.RepositoryDestinationsCurrent))

	// a shrunk config re-inits the gauge downward — the config-loss signal
	shrunk, err := NewYamlConfigurationSource([]byte("destinations:\n  d1: {}\n"))
	require.NoError(t, err)
	_, err = NewRepository(nil, shrunk)
	require.NoError(t, err)
	require.Equal(t, 1.0, testutil.ToFloat64(metrics.RepositoryDestinationsCurrent))
}
