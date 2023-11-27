package meta

import (
	"github.com/stretchr/testify/require"
	"testing"
)

func TestExtractFromSentinelURL(t *testing.T) {
	tests := []struct {
		name               string
		inputURL           string
		expectedMasterName string
		expectedPassword   string
		expectedNodes      []string
		expectedErr        string
	}{
		{
			"filled URL",
			"sentinel://master_name:password@node1:port,node2:port",
			"master_name",
			"password",
			[]string{"node1:port", "node2:port"},
			"",
		},
		{
			"URL without password",
			"sentinel://master_name@node1:port,node2:port",
			"master_name",
			"",
			[]string{"node1:port", "node2:port"},
			"",
		},
		{
			"URL with one node",
			"sentinel://master_name@node1:port",
			"master_name",
			"",
			[]string{"node1:port"},
			"",
		},
		{
			"Malformed URL",
			"sentinel://master_name:node1:port",
			"",
			"",
			nil,
			errMalformedURL.Error(),
		},
		{
			"Malformed URL",
			"sentinel://node1:port",
			"",
			"",
			nil,
			errMalformedURL.Error(),
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			actualMasterName, actualPassword, actualNodes, err := extractFromSentinelURL(tt.inputURL)
			if tt.expectedErr == "" {
				require.NoError(t, err, "extractFromSentinelURL shouldn't return an error")
			} else {
				require.Equal(t, tt.expectedErr, err.Error(), "extractFromSentinelURL errors aren't equal")
				return
			}

			require.Equal(t, tt.expectedMasterName, actualMasterName, "master names errors aren't equal")
			require.Equal(t, tt.expectedPassword, actualPassword, "passwords errors aren't equal")
			require.Equal(t, tt.expectedNodes, actualNodes, "nodes errors aren't equal")
		})
	}
}

func TestGetSentinelAndDialFunc(t *testing.T) {
	tests := []struct {
		name             string
		factory          *RedisPoolFactory
		expectedSentinel bool
		expectedErr      string
	}{
		{
			"redis URL",
			NewRedisPoolFactory("redis://localhost:6379", 0, "", 0, false, ""),
			false,
			"",
		},
		{
			"redis secured URL",
			NewRedisPoolFactory("rediss://localhost:6379", 0, "", 0, false, ""),
			false,
			"",
		},
		{
			"redis sentinel URL",
			NewRedisPoolFactory("sentinel://master:pas@localhost:6379", 0, "", 0, false, ""),
			true,
			"",
		},
		{
			"redis plain config",
			NewRedisPoolFactory("host", 0, "pass", 0, false, ""),
			false,
			"",
		},
		{
			"redis plain config with sentinel",
			NewRedisPoolFactory("host", 0, "pass", 0, false, "sent"),
			true,
			"",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			redisSentinel, _, err := tt.factory.getSentinelAndDialFunc()
			if tt.expectedErr == "" {
				require.NoError(t, err, "getSentinelAndDialFunc shouldn't return an error")
			} else {
				require.Equal(t, tt.expectedErr, err.Error(), "getSentinelAndDialFunc errors aren't equal")
				return
			}

			if tt.expectedSentinel {
				require.NotNil(t, redisSentinel)
				redisSentinel.Close()
			}
		})
	}
}
