package sql

import (
	"testing"

	types2 "github.com/jitsucom/bulker/bulkerlib/types"
	"github.com/jitsucom/bulker/jitsubase/jsonorder"
	"github.com/stretchr/testify/require"
)

// TestSamePatch covers the decision ensureTable makes after a patch fails: re-reading
// the table tells it whether its view was stale (retry) or whether the database is
// rejecting the patch itself (give up, and report why).
func TestSamePatch(t *testing.T) {
	columns := func(pairs ...string) Columns {
		cols := NewColumns(len(pairs) / 2)
		for i := 0; i < len(pairs); i += 2 {
			cols.Set(pairs[i], types2.SQLColumn{Type: pairs[i+1]})
		}
		return cols
	}
	diff := func(cols Columns, pk ...string) *Table {
		return &Table{Columns: cols, PKFields: jsonorder.NewOrderedSet[string](pk...)}
	}

	tests := []struct {
		name     string
		before   *Table
		after    *Table
		expected bool
	}{
		{
			// the table has duplicate rows, so the primary key is refused every time -
			// retrying only rebuilds the same unique index on the destination
			name:     "same primary key still missing",
			before:   diff(NewColumns(0), "id"),
			after:    diff(NewColumns(0), "id"),
			expected: true,
		},
		{
			// what JITSU-157 is about: another instance added the column while our batch
			// was running, so the fresh schema has less to do and the retry succeeds
			name:     "column arrived while we were patching",
			before:   diff(columns("b", "text")),
			after:    diff(NewColumns(0)),
			expected: false,
		},
		{
			name:     "same column still missing",
			before:   diff(columns("b", "text")),
			after:    diff(columns("b", "text")),
			expected: true,
		},
		{
			name:     "same column name, different type",
			before:   diff(columns("b", "text")),
			after:    diff(columns("b", "bigint")),
			expected: false,
		},
		{
			name:     "one of the columns arrived",
			before:   diff(columns("b", "text", "c", "text")),
			after:    diff(columns("c", "text")),
			expected: false,
		},
		{
			name:     "primary key gained a field",
			before:   diff(NewColumns(0), "id"),
			after:    diff(NewColumns(0), "id", "day"),
			expected: false,
		},
		{
			name:     "primary key rename to drop is new",
			before:   diff(NewColumns(0), "id"),
			after:    &Table{Columns: NewColumns(0), PKFields: jsonorder.NewOrderedSet[string]("id"), DeletePrimaryKeyNamed: "jitsu_pk_old"},
			expected: false,
		},
		{
			name:     "nothing to do either way",
			before:   diff(NewColumns(0)),
			after:    diff(NewColumns(0)),
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			require.Equal(t, tt.expected, tt.after.samePatch(tt.before))
			require.Equal(t, tt.expected, tt.before.samePatch(tt.after), "comparison must be symmetric")
		})
	}
}
