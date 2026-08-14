package driver

import (
	"context"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/redshiftdata"
)

type RedshiftClient interface {
	ExecuteStatement(ctx context.Context, params *redshiftdata.ExecuteStatementInput, optFns ...func(*redshiftdata.Options)) (*redshiftdata.ExecuteStatementOutput, error)
	DescribeStatement(ctx context.Context, params *redshiftdata.DescribeStatementInput, optFns ...func(*redshiftdata.Options)) (*redshiftdata.DescribeStatementOutput, error)
	CancelStatement(ctx context.Context, params *redshiftdata.CancelStatementInput, optFns ...func(*redshiftdata.Options)) (*redshiftdata.CancelStatementOutput, error)
	BatchExecuteStatement(ctx context.Context, params *redshiftdata.BatchExecuteStatementInput, optFns ...func(*redshiftdata.Options)) (*redshiftdata.BatchExecuteStatementOutput, error)
	redshiftdata.GetStatementResultAPIClient
}

func newRedshiftDataClient(ctx context.Context, cfg *RedshiftConfig, opts ...func(*config.LoadOptions) error) (RedshiftClient, error) {
	awsCfg, err := config.LoadDefaultConfig(ctx, opts...)
	if err != nil {
		return nil, err
	}
	client := redshiftdata.NewFromConfig(awsCfg, cfg.Opts()...)
	// throttles wrapped in non-retryable errors bypass the SDK retryer — see throttle.go
	return newThrottleRetryClient(client, throttleRetryMaxAttempts), nil
}
