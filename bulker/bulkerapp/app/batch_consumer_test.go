package app

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestIsAbortedTransactionError(t *testing.T) {
	testCases := []struct {
		desc     string
		err      error
		expected bool
	}{
		{
			desc: "aborted transaction as it reaches the batch consumer",
			// a real failure from JITSU-157: the ALTER TABLE that aborted the transaction
			// is nowhere in the message, only the aftermath every next statement runs into
			err:      fmt.Errorf("Failed to commit bulker stream to postgres: failed to ensure destination table, cause: report.sql.get_table: failed to get table columns, cause: ERROR: current transaction is aborted, commands ignored until end of transaction block (SQLSTATE 25P02)"),
			expected: true,
		},
		{
			desc:     "the statement that aborts the transaction is not itself sticky",
			err:      fmt.Errorf(`report.sql.patch_table: failed to patch table, cause: ERROR: column "b" of relation "events" already exists (SQLSTATE 42701)`),
			expected: false,
		},
		{
			desc:     "unrelated destination failure",
			err:      fmt.Errorf("Failed to commit bulker stream to mysql: dial tcp 10.0.0.1:3306: connect: connection refused"),
			expected: false,
		},
		{
			desc:     "no error",
			err:      nil,
			expected: false,
		},
	}
	for _, tc := range testCases {
		t.Run(tc.desc, func(t *testing.T) {
			assert.Equal(t, tc.expected, isAbortedTransactionError(tc.err))
		})
	}
}
