package driver

import (
	"context"
	"errors"
	"testing"

	"github.com/aws/aws-sdk-go-v2/service/redshiftdata"
	"github.com/stretchr/testify/require"
)

// the exact wrapper shape observed in CI: a 400 ValidationException carrying a
// throttle from the underlying serverless service, which the SDK never retries
var wrappedThrottle = errors.New("operation error Redshift Data: ExecuteStatement, https response error StatusCode: 400, " +
	"RequestID: x, ValidationException: Service returned error code ThrottlingException (Service: RedshiftServerless, Status Code: 400)")

type throttlingMockClient struct {
	mockRedshiftClient
	failures   int
	execCalls  int
	seenTokens []string
}

func (m *throttlingMockClient) ExecuteStatement(_ context.Context, params *redshiftdata.ExecuteStatementInput, _ ...func(*redshiftdata.Options)) (*redshiftdata.ExecuteStatementOutput, error) {
	m.execCalls++
	if params.ClientToken != nil {
		m.seenTokens = append(m.seenTokens, *params.ClientToken)
	} else {
		m.seenTokens = append(m.seenTokens, "")
	}
	if m.execCalls <= m.failures {
		return nil, wrappedThrottle
	}
	return &redshiftdata.ExecuteStatementOutput{}, nil
}

func TestThrottleRetryRecoversWrappedThrottle(t *testing.T) {
	mock := &throttlingMockClient{failures: 3}
	client := newThrottleRetryClient(mock, 20)
	_, err := client.ExecuteStatement(context.Background(), &redshiftdata.ExecuteStatementInput{})
	require.NoError(t, err)
	require.Equal(t, 4, mock.execCalls)
	// every retry must reuse ONE idempotency token so the service can dedupe a
	// re-submission — a fresh token per attempt could double-run DML
	require.Len(t, mock.seenTokens, 4)
	require.NotEmpty(t, mock.seenTokens[0])
	for _, token := range mock.seenTokens {
		require.Equal(t, mock.seenTokens[0], token)
	}
}

func TestThrottleRetryGivesUpAfterMaxAttempts(t *testing.T) {
	mock := &throttlingMockClient{failures: 100}
	client := newThrottleRetryClient(mock, 3)
	_, err := client.ExecuteStatement(context.Background(), &redshiftdata.ExecuteStatementInput{})
	require.Error(t, err)
	require.Contains(t, err.Error(), "ThrottlingException")
	require.Equal(t, 3, mock.execCalls)
}

func TestThrottleRetryPassesThroughOtherErrors(t *testing.T) {
	require.False(t, isWrappedThrottleError(nil))
	require.False(t, isWrappedThrottleError(errors.New("ValidationException: column does not exist")))
	require.True(t, isWrappedThrottleError(wrappedThrottle))
	require.True(t, isWrappedThrottleError(errors.New("ThrottlingException: Rate exceeded")))
}

func TestThrottleRetryRespectsContext(t *testing.T) {
	mock := &throttlingMockClient{failures: 100}
	client := newThrottleRetryClient(mock, 20)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := client.ExecuteStatement(ctx, &redshiftdata.ExecuteStatementInput{})
	require.Error(t, err)
	// cancelled context stops the retry loop after the first attempt
	require.Equal(t, 1, mock.execCalls)
}
