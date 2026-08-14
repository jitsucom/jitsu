package driver

import (
	"context"
	"fmt"
	"math/rand"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/redshiftdata"
	"github.com/jitsucom/bulker/jitsubase/uuid"
)

// The Redshift Data API can wrap a throttle from an underlying service inside a
// non-retryable error: e.g. "ValidationException: Service returned error code
// ThrottlingException (Service: RedshiftServerless, Status Code: 400)". The AWS
// SDK retryer classifies the outer 400 ValidationException as a client error
// and never retries it — neither standard nor adaptive mode helps. This
// decorator retries any error whose text carries a throttle signal, with
// exponential backoff + jitter, on every Data API call (including the
// GetStatementResult paginator, which takes the client interface).

const (
	throttleRetryMinDelay = 250 * time.Millisecond
	throttleRetryMaxDelay = 10 * time.Second
	// dedicated cap, deliberately smaller than the SDK retryer's retryMaxAttempts:
	// for errors both layers deem retryable the attempts multiply, and the
	// statement Timeout is not set by default — keep worst-case latency bounded
	// (~30s of sleep) without a configured timeout
	throttleRetryMaxAttempts = 8
)

func isWrappedThrottleError(err error) bool {
	if err == nil {
		return false
	}
	message := err.Error()
	return strings.Contains(message, "ThrottlingException") ||
		strings.Contains(message, "Rate exceeded") ||
		strings.Contains(message, "SlowDown")
}

type throttleRetryClient struct {
	inner       RedshiftClient
	maxAttempts int
}

func newThrottleRetryClient(inner RedshiftClient, maxAttempts int) *throttleRetryClient {
	return &throttleRetryClient{inner: inner, maxAttempts: maxAttempts}
}

// withThrottleRetry runs call until it succeeds, fails with a non-throttle
// error, exhausts attempts, or the context ends. On cancellation the returned
// error wraps ctx.Err() (so errors.Is detects it) while keeping the last
// throttle error text for diagnostics
func (c *throttleRetryClient) withThrottleRetry(ctx context.Context, call func() error) error {
	delay := throttleRetryMinDelay
	var err error
	for attempt := 0; attempt < c.maxAttempts; attempt++ {
		err = call()
		if !isWrappedThrottleError(err) {
			return err
		}
		if ctx.Err() != nil {
			return fmt.Errorf("%w (last throttle error: %v)", ctx.Err(), err)
		}
		if attempt+1 == c.maxAttempts {
			// terminal failure — don't pay a sleep with no retry after it
			break
		}
		// equal jitter in [delay/2, delay]: randomized to decorrelate concurrent
		// clients, but never exceeding the current backoff ceiling
		sleep := delay/2 + time.Duration(rand.Int63n(int64(delay/2)+1))
		select {
		case <-ctx.Done():
			return fmt.Errorf("%w (last throttle error: %v)", ctx.Err(), err)
		case <-time.After(sleep):
		}
		delay *= 2
		if delay > throttleRetryMaxDelay {
			delay = throttleRetryMaxDelay
		}
	}
	return err
}

// ExecuteStatement and BatchExecuteStatement SUBMIT statements, so retrying
// them must never double-run DML. Two layers make that safe:
//   - only explicit throttle RESPONSES are retried (the server answered
//     "rejected before acceptance"); ambiguous transport errors are not
//   - the idempotency token is pinned BEFORE the retry loop. The SDK auto-fills
//     ClientToken per invocation, so its own internal retries share one token,
//     but each decorator re-invocation would get a fresh one — pinning it here
//     makes the service dedupe re-submissions even in ambiguous edge cases
func (c *throttleRetryClient) ExecuteStatement(ctx context.Context, params *redshiftdata.ExecuteStatementInput, optFns ...func(*redshiftdata.Options)) (out *redshiftdata.ExecuteStatementOutput, err error) {
	if params == nil {
		// the generated SDK methods tolerate nil input; stay transparent
		params = &redshiftdata.ExecuteStatementInput{}
	}
	if params.ClientToken == nil {
		params.ClientToken = aws.String(uuid.New())
	}
	err = c.withThrottleRetry(ctx, func() error {
		out, err = c.inner.ExecuteStatement(ctx, params, optFns...)
		return err
	})
	return out, err
}

func (c *throttleRetryClient) BatchExecuteStatement(ctx context.Context, params *redshiftdata.BatchExecuteStatementInput, optFns ...func(*redshiftdata.Options)) (out *redshiftdata.BatchExecuteStatementOutput, err error) {
	if params == nil {
		params = &redshiftdata.BatchExecuteStatementInput{}
	}
	if params.ClientToken == nil {
		params.ClientToken = aws.String(uuid.New())
	}
	err = c.withThrottleRetry(ctx, func() error {
		out, err = c.inner.BatchExecuteStatement(ctx, params, optFns...)
		return err
	})
	return out, err
}

func (c *throttleRetryClient) DescribeStatement(ctx context.Context, params *redshiftdata.DescribeStatementInput, optFns ...func(*redshiftdata.Options)) (out *redshiftdata.DescribeStatementOutput, err error) {
	err = c.withThrottleRetry(ctx, func() error {
		out, err = c.inner.DescribeStatement(ctx, params, optFns...)
		return err
	})
	return out, err
}

func (c *throttleRetryClient) CancelStatement(ctx context.Context, params *redshiftdata.CancelStatementInput, optFns ...func(*redshiftdata.Options)) (out *redshiftdata.CancelStatementOutput, err error) {
	err = c.withThrottleRetry(ctx, func() error {
		out, err = c.inner.CancelStatement(ctx, params, optFns...)
		return err
	})
	return out, err
}

func (c *throttleRetryClient) GetStatementResult(ctx context.Context, params *redshiftdata.GetStatementResultInput, optFns ...func(*redshiftdata.Options)) (out *redshiftdata.GetStatementResultOutput, err error) {
	err = c.withThrottleRetry(ctx, func() error {
		out, err = c.inner.GetStatementResult(ctx, params, optFns...)
		return err
	})
	return out, err
}
