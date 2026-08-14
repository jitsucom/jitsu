package driver

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/redshiftdata"
	"github.com/aws/aws-sdk-go-v2/service/redshiftdata/types"
)

type redshiftConnection struct {
	client RedshiftClient
	cfg    *RedshiftConfig

	isClosed bool
	closed   chan struct{}

	inTx          bool
	txOpts        driver.TxOptions
	sqls          []string
	delayedResult []*redshiftDelayedResult
	sessionId     *string
}

func newConnection(client RedshiftClient, cfg *RedshiftConfig) *redshiftConnection {
	return &redshiftConnection{
		client: client,
		cfg:    cfg,
		closed: make(chan struct{}),
	}
}

func (c *redshiftConnection) Ping(ctx context.Context) error {
	_, err := c.ExecContext(ctx, "select 1", nil)
	return err
}

func (c *redshiftConnection) PrepareContext(_ context.Context, query string) (driver.Stmt, error) {
	return &redshiftStatement{
		connection: c,
		query:      query,
	}, nil
}

func (c *redshiftConnection) Prepare(query string) (driver.Stmt, error) {
	return nil, driver.ErrSkip
}

func (c *redshiftConnection) Close() error {
	if c.isClosed {
		return nil
	}
	c.isClosed = true
	close(c.closed)
	return nil
}

func (c *redshiftConnection) BeginTx(ctx context.Context, opts driver.TxOptions) (driver.Tx, error) {
	if c.inTx {
		return nil, ErrInTx
	}
	if opts.Isolation != driver.IsolationLevel(sql.LevelDefault) {
		return nil, fmt.Errorf("transaction isolation level change: %w", ErrNotSupported)
	}
	c.inTx = true
	c.txOpts = opts
	cleanup := func() { // nolint: unparam
		c.inTx = false
		c.sqls = nil
		c.delayedResult = nil
		return
	}
	tx := &redshiftTx{
		onRollback: func() error {
			if !c.inTx {
				return ErrNotInTx
			}
			cleanup()
			return nil
		},
		onCommit: func() error {
			if !c.inTx {
				return ErrNotInTx
			}
			defer cleanup()
			if len(c.sqls) == 0 {
				return nil
			}
			if len(c.sqls) != len(c.delayedResult) {
				panic(fmt.Sprintf("sqls and delayedResult length is not match: sqls=%d delayedResult=%d", len(c.sqls), len(c.delayedResult)))
			}
			if len(c.sqls) == 1 {
				params := &redshiftdata.ExecuteStatementInput{
					Sql:        nullStringIfEmpty(c.sqls[0]),
					Parameters: nil,
				}
				_, output, err := c.executeStatement(ctx, params)
				if err != nil {
					return err
				}
				if c.delayedResult[0] != nil {
					c.delayedResult[0].Result = newResult(output)
				}
				return nil
			}
			input := &redshiftdata.BatchExecuteStatementInput{
				Sqls: append(make([]string, 0, len(c.sqls)), c.sqls...),
			}
			_, desc, err := c.batchExecuteStatement(ctx, input)
			if err != nil {
				return err
			}
			for i := range input.Sqls {
				if i >= len(desc.SubStatements) {
					return fmt.Errorf("sub statement not found: %d", i)
				}
				if c.delayedResult[i] != nil {
					c.delayedResult[i].Result = newResultWithSubStatementData(desc.SubStatements[i])
				}
			}
			return nil
		},
	}

	return tx, nil
}

func (c *redshiftConnection) Begin() (driver.Tx, error) {
	return c.BeginTx(context.Background(), driver.TxOptions{})
}

func (c *redshiftConnection) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	if c.inTx {
		return nil, fmt.Errorf("query in transaction: %w", ErrNotSupported)
	}

	params := &redshiftdata.ExecuteStatementInput{
		Sql:        nullStringIfEmpty(rewriteQuery(query, len(args) > 0)),
		Parameters: convertArgsToParameters(args),
	}
	p, output, err := c.executeStatement(ctx, params)
	if err != nil {
		return nil, err
	}
	return newRows(ctx, coalesce(output.Id), p)
}

func (c *redshiftConnection) ExecContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	if c.inTx {
		if len(args) > 0 {
			return nil, fmt.Errorf("exec with args in transaction: %w", ErrNotSupported)
		}
		if c.txOpts.ReadOnly {
			return nil, fmt.Errorf("exec in read only transaction: %w", ErrNotSupported)
		}
		c.sqls = append(c.sqls, query)
		result := &redshiftDelayedResult{}
		c.delayedResult = append(c.delayedResult, result)
		return result, nil
	}

	params := &redshiftdata.ExecuteStatementInput{
		Sql:        nullStringIfEmpty(rewriteQuery(query, len(args) > 0)),
		Parameters: convertArgsToParameters(args),
	}
	_, output, err := c.executeStatement(ctx, params)
	if err != nil {
		return nil, err
	}
	return newResult(output), nil
}

func rewriteQuery(query string, scanParams bool) string {
	if !scanParams {
		return query
	}
	runes := make([]rune, 0, len(query))
	stack := make([]rune, 0)
	var exclamationCount int
	for _, r := range query {
		if len(stack) > 0 {
			if r == stack[len(stack)-1] {
				stack = stack[:len(stack)-1]
				runes = append(runes, r)
				continue
			}
		} else {
			switch r {
			case '?':
				exclamationCount++
				runes = append(runes, []rune(fmt.Sprintf(":%d", exclamationCount))...)
				continue
			case '$':
				runes = append(runes, ':')
				continue
			}
		}
		switch r {
		case '"', '\'':
			stack = append(stack, r)
		}
		runes = append(runes, r)
	}
	return string(runes)
}

func convertArgsToParameters(args []driver.NamedValue) []types.SqlParameter {
	if len(args) == 0 {
		return nil
	}
	scanParams := make([]types.SqlParameter, 0, len(args))
	for _, arg := range args {
		scanParams = append(scanParams, types.SqlParameter{
			Name:  aws.String(coalesce(nullStringIfEmpty(arg.Name), aws.String(fmt.Sprintf("%d", arg.Ordinal)))),
			Value: aws.String(fmt.Sprintf("%v", arg.Value)),
		})
	}
	return scanParams
}

func (c *redshiftConnection) executeStatement(ctx context.Context, params *redshiftdata.ExecuteStatementInput) (*redshiftdata.GetStatementResultPaginator, *redshiftdata.DescribeStatementOutput, error) {
	params.Database = nullStringIfEmpty(c.cfg.Db)
	params.ClusterIdentifier = nullStringIfEmpty(c.cfg.ClusterIdentifier)
	params.WorkgroupName = nullStringIfEmpty(c.cfg.WorkgroupName)
	params.DbUser = nullStringIfEmpty(c.cfg.Username)
	params.SecretArn = nullStringIfEmpty(c.cfg.SecretsARN)

	executeOutput, err := c.client.ExecuteStatement(ctx, params)
	if err != nil {
		return nil, nil, fmt.Errorf("execute statement:%w", err)
	}
	describeOutput, err := c.wait(ctx, executeOutput.Id)
	if err != nil {
		return nil, nil, err
	}
	if describeOutput.Status == types.StatusStringAborted {
		return nil, nil, fmt.Errorf("query aborted: %s", *describeOutput.Error)
	}
	if describeOutput.Status == types.StatusStringFailed {
		return nil, nil, fmt.Errorf("query failed: %s", *describeOutput.Error)
	}
	if describeOutput.Status != types.StatusStringFinished {
		return nil, nil, fmt.Errorf("query status is not finished: %s", describeOutput.Status)
	}
	if !*describeOutput.HasResultSet {
		return nil, describeOutput, nil
	}
	p := redshiftdata.NewGetStatementResultPaginator(c.client, &redshiftdata.GetStatementResultInput{
		Id: executeOutput.Id,
	})
	return p, describeOutput, nil
}

func (c *redshiftConnection) batchExecuteStatement(ctx context.Context, params *redshiftdata.BatchExecuteStatementInput) ([]*redshiftdata.GetStatementResultPaginator, *redshiftdata.DescribeStatementOutput, error) {
	params.ClusterIdentifier = nullStringIfEmpty(c.cfg.ClusterIdentifier)
	params.Database = nullStringIfEmpty(c.cfg.Db)
	params.DbUser = nullStringIfEmpty(c.cfg.Username)
	params.WorkgroupName = nullStringIfEmpty(c.cfg.WorkgroupName)
	params.SecretArn = nullStringIfEmpty(c.cfg.SecretsARN)

	batchExecuteOutput, err := c.client.BatchExecuteStatement(ctx, params)
	if err != nil {
		return nil, nil, fmt.Errorf("execute statement:%w", err)
	}
	describeOutput, err := c.wait(ctx, batchExecuteOutput.Id)
	if err != nil {
		return nil, nil, err
	}
	if describeOutput.Status == types.StatusStringAborted {
		return nil, nil, fmt.Errorf("query aborted: %s", *describeOutput.Error)
	}
	if describeOutput.Status == types.StatusStringFailed {
		return nil, nil, fmt.Errorf("query failed: %s", *describeOutput.Error)
	}
	if describeOutput.Status != types.StatusStringFinished {
		return nil, nil, fmt.Errorf("query status is not finished: %s", describeOutput.Status)
	}
	ps := make([]*redshiftdata.GetStatementResultPaginator, len(params.Sqls))
	for i, st := range describeOutput.SubStatements {
		if *st.HasResultSet {
			continue
		}
		ps[i] = redshiftdata.NewGetStatementResultPaginator(c.client, &redshiftdata.GetStatementResultInput{
			Id: st.Id,
		})
	}
	return ps, describeOutput, nil
}

func isFinishedStatus(status types.StatusString) bool {
	return status == types.StatusStringFinished || status == types.StatusStringFailed || status == types.StatusStringAborted
}

// wait for the query to finish using an exponential backoff
func (c *redshiftConnection) wait(ctx context.Context, id *string) (output *redshiftdata.DescribeStatementOutput, err error) {
	polling := c.cfg.GetMinPolling()
	if c.cfg.Timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, c.cfg.Timeout)
		defer cancel()
	}

	// cancelStatement cancels the query in case of a timeout
	cancelStatement := func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, _ = c.client.CancelStatement(ctx, &redshiftdata.CancelStatementInput{Id: id})
	}

	// describeOutput describes the query and returns true if the query is finished
	// or polling should stop. A transient DescribeStatement failure (e.g. Data API
	// throttling after the SDK retryer gave up) must NOT abandon a query that is
	// still running server-side — keep polling and only give up after several
	// consecutive failures
	const maxConsecutiveDescribeErrors = 5
	consecutiveErrors := 0
	describeOutput := func() bool {
		var describeErr error
		output, describeErr = c.client.DescribeStatement(ctx, &redshiftdata.DescribeStatementInput{
			Id: id,
		})
		if describeErr != nil {
			output = nil
			consecutiveErrors++
			if ctx.Err() != nil || consecutiveErrors >= maxConsecutiveDescribeErrors {
				err = describeErr
				return true
			}
			return false
		}
		consecutiveErrors = 0
		err = nil
		if isFinishedStatus(output.Status) {
			return true
		}
		return false
	}

	//if describeOutput() {
	//	return output, err
	//}

	for {
		select {
		case <-ctx.Done():
			cancelStatement()
			return nil, ctx.Err()
		case <-c.closed:
			cancelStatement()
			return nil, ErrConnClosed
		case <-time.After(polling):
		}
		if describeOutput() {
			return output, err
		}
		polling = polling * 2
		if polling > c.cfg.GetMaxPolling() {
			polling = c.cfg.GetMaxPolling()
		}
	}
}
