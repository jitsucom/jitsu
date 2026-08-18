package driver

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/redshiftdata"
	"github.com/aws/aws-sdk-go-v2/service/redshiftdata/types"
	"github.com/stretchr/testify/require"
)

type mockRedshiftClient struct {
	describeErrors    int // fail this many DescribeStatement calls before succeeding
	describeCallCount int
	cancelCallCount   int
}

func (m *mockRedshiftClient) ExecuteStatement(_ context.Context, _ *redshiftdata.ExecuteStatementInput, _ ...func(*redshiftdata.Options)) (*redshiftdata.ExecuteStatementOutput, error) {
	return nil, errors.New("not implemented")
}

func (m *mockRedshiftClient) BatchExecuteStatement(_ context.Context, _ *redshiftdata.BatchExecuteStatementInput, _ ...func(*redshiftdata.Options)) (*redshiftdata.BatchExecuteStatementOutput, error) {
	return nil, errors.New("not implemented")
}

func (m *mockRedshiftClient) CancelStatement(_ context.Context, _ *redshiftdata.CancelStatementInput, _ ...func(*redshiftdata.Options)) (*redshiftdata.CancelStatementOutput, error) {
	m.cancelCallCount++
	return &redshiftdata.CancelStatementOutput{}, nil
}

func (m *mockRedshiftClient) GetStatementResult(_ context.Context, _ *redshiftdata.GetStatementResultInput, _ ...func(*redshiftdata.Options)) (*redshiftdata.GetStatementResultOutput, error) {
	return nil, errors.New("not implemented")
}

func (m *mockRedshiftClient) DescribeStatement(_ context.Context, _ *redshiftdata.DescribeStatementInput, _ ...func(*redshiftdata.Options)) (*redshiftdata.DescribeStatementOutput, error) {
	m.describeCallCount++
	if m.describeCallCount <= m.describeErrors {
		return nil, errors.New("ThrottlingException: rate exceeded")
	}
	hasResultSet := false
	return &redshiftdata.DescribeStatementOutput{Status: types.StatusStringFinished, HasResultSet: &hasResultSet}, nil
}

func waitTestConnection(client RedshiftClient) *redshiftConnection {
	return newConnection(client, &RedshiftConfig{
		MinPolling: time.Millisecond,
		MaxPolling: 2 * time.Millisecond,
	})
}

func TestWaitToleratesTransientDescribeErrors(t *testing.T) {
	client := &mockRedshiftClient{describeErrors: 3}
	c := waitTestConnection(client)
	output, err := c.wait(context.Background(), nil)
	require.NoError(t, err)
	require.Equal(t, types.StatusStringFinished, output.Status)
	require.Equal(t, 4, client.describeCallCount)
}

func TestWaitGivesUpAfterConsecutiveDescribeErrors(t *testing.T) {
	client := &mockRedshiftClient{describeErrors: 100}
	c := waitTestConnection(client)
	_, err := c.wait(context.Background(), nil)
	require.Error(t, err)
	require.Contains(t, err.Error(), "ThrottlingException")
	require.Equal(t, 5, client.describeCallCount)
	// the statement's outcome is unknown at give-up: it must be cancelled so a
	// late completion can't land effects behind the caller's back
	require.Equal(t, 1, client.cancelCallCount)
}

func TestRewriteQuery(t *testing.T) {
	cases := []struct {
		casename string
		query    string
		params   bool
		expected string
	}{
		{
			casename: "no params",
			query:    `SELECT * FROM pg_user`,
			params:   false,
			expected: `SELECT * FROM pg_user`,
		},
		{
			casename: "no change",
			query:    `SELECT * FROM pg_user WHERE usename = :name`,
			params:   true,
			expected: `SELECT * FROM pg_user WHERE usename = :name`,
		},
		{
			casename: "? rewrite",
			query:    `SELECT 'hoge?' FROM pg_user WHERE usename = ? AND usesysid > ?`,
			params:   true,
			expected: `SELECT 'hoge?' FROM pg_user WHERE usename = :1 AND usesysid > :2`,
		},
		{
			casename: "$ rewrite",
			query:    `SELECT '3$1$' FROM table WHERE "$column" = $1 AND column1 > $2 AND column2 < $1`,
			params:   true,
			expected: `SELECT '3$1$' FROM table WHERE "$column" = :1 AND column1 > :2 AND column2 < :1`,
		},
	}
	for _, c := range cases {
		t.Run(c.casename, func(t *testing.T) {
			actual := rewriteQuery(c.query, c.params)
			require.Equal(t, c.expected, actual)
		})
	}
}
