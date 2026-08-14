package driver

import (
	"net/url"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/stretchr/testify/require"
)

func TestRedshiftDataConfig__String(t *testing.T) {
	cases := []struct {
		dsn      *RedshiftConfig
		expected string
	}{
		{
			dsn:      &RedshiftConfig{},
			expected: "",
		},
		{
			dsn: &RedshiftConfig{
				ClusterIdentifier: "default",
				Username:          "admin",
				Db:                "dev",
			},
			expected: "admin@cluster(default)/dev",
		},
		{
			dsn: &RedshiftConfig{
				ClusterIdentifier: "default",
				Username:          "admin",
				Db:                "dev",
				Timeout:           15 * time.Minute,
				Region:            "us-east-1",
			},
			expected: "admin@cluster(default)/dev?region=us-east-1&timeout=15m0s",
		},
		{
			dsn: &RedshiftConfig{
				ClusterIdentifier: "default",
				Username:          "admin",
				Db:                "dev",
				MinPolling:        5 * time.Millisecond,
				MaxPolling:        2 * time.Second,
				RetryMaxAttempts:  3,
			},
			expected: "admin@cluster(default)/dev?maxPolling=2s&minPolling=5ms&retryMaxAttempts=3",
		},
		{
			dsn: &RedshiftConfig{
				ClusterIdentifier: "default",
				Username:          "admin",
				Db:                "dev",
				Params: url.Values{
					"extra": []string{"hoge"},
				},
			},
			expected: "admin@cluster(default)/dev?extra=hoge",
		},
		{
			dsn: &RedshiftConfig{
				ClusterIdentifier: "default",
				Username:          "admin",
				Db:                "dev",
				Region:            "us-east-1",
			},
			expected: "admin@cluster(default)/dev?region=us-east-1",
		},
		{
			dsn: &RedshiftConfig{
				WorkgroupName: "default",
				Db:            "dev",
			},
			expected: "workgroup(default)/dev",
		},
		{
			dsn: &RedshiftConfig{
				SecretsARN: "arn:aws:secretsmanager:us-east-1:0123456789012:secret:redshift",
				Timeout:    30 * time.Second,
			},
			expected: "arn:aws:secretsmanager:us-east-1:0123456789012:secret:redshift?timeout=30s",
		},
		{
			dsn: &RedshiftConfig{
				ClusterIdentifier:   "default",
				Username:            "admin",
				Db:                  "dev",
				Region:              "us-east-1",
				SharedConfigProfile: "default",
			},
			expected: "admin@cluster(default)/dev?region=us-east-1&sharedConfigProfile=default",
		},
		{
			dsn: &RedshiftConfig{
				ClusterIdentifier: "default",
				Username:          "admin",
				Db:                "dev",
				Region:            "us-east-1",
				AccessKeyID:       "accessKeyID",
				SecretAccessKey:   "secretAccessKey",
				SessionToken:      "sessionToken",
			},
			expected: "admin@cluster(default)/dev?accessKeyId=accessKeyID&region=us-east-1&secretAccessKey=secretAccessKey&sessionToken=sessionToken",
		},
		{
			dsn: &RedshiftConfig{
				ClusterIdentifier: "default",
				Username:          "admin",
				Db:                "dev",
				Region:            "us-east-1",
				RoleARN:           "roleARN",
				ExternalID:        "externalID",
				RoleARNExpiry:     15 * time.Minute,
			},
			expected: "admin@cluster(default)/dev?externalID=externalID&region=us-east-1&roleARN=roleARN&roleARNExpiry=15m0s",
		},
	}

	for _, c := range cases {
		t.Run(c.expected, func(t *testing.T) {
			actual := c.dsn.String()
			require.Equal(t, c.expected, actual)
			if c.expected != "" {
				cfg, err := ParseDSN(actual)
				require.NoError(t, err)
				require.EqualValues(t, c.dsn, cfg)
			}
		})
	}
}

func TestRedshiftConfigRetryMode(t *testing.T) {
	// default is adaptive: Data API TPS quotas are account-wide
	require.Equal(t, aws.RetryModeAdaptive, (&RedshiftConfig{}).GetRetryMode())
	require.Equal(t, aws.RetryModeStandard, (&RedshiftConfig{RetryMode: "standard"}).GetRetryMode())

	cfg, err := ParseDSN("admin@cluster(default)/dev?retryMode=standard")
	require.NoError(t, err)
	require.Equal(t, "standard", cfg.RetryMode)

	_, err = ParseDSN("admin@cluster(default)/dev?retryMode=aggressive")
	require.Error(t, err)
}

func TestRedshiftConfigSanitize(t *testing.T) {
	t.Run("cluster config", func(t *testing.T) {
		c := RedshiftConfig{
			AuthenticationMethod: "iam",
			Serverless:           false,
			ClusterIdentifier:    "default",
			WorkgroupName:        "default",
			Username:             "admin",
		}

		c.Sanitize()
		require.NotEmpty(t, c.ClusterIdentifier)
		require.Empty(t, c.WorkgroupName)
		require.NotEmpty(t, c.Username)
	})

	t.Run("workgroup config", func(t *testing.T) {
		c := RedshiftConfig{
			AuthenticationMethod: "iam",
			Serverless:           true,
			WorkgroupName:        "default",
			Username:             "admin",
		}

		c.Sanitize()
		require.NotEmpty(t, c.WorkgroupName)
		require.Empty(t, c.Username)
	})
}
