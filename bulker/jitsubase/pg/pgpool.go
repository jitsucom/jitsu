package pg

import (
	"context"
	"fmt"
	"regexp"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PoolOption customises the pgxpool.Config before the pool is constructed.
type PoolOption func(*pgxpool.Config)

// WithStatementTimeout sets the server-side statement_timeout on every
// connection from the pool, bounding any single Exec/Query at `timeout`.
// On expiry Postgres cancels the query and returns an error (releasing the
// connection cleanly back to the pool) instead of letting a stuck server
// or lock wait block the caller indefinitely. A statement_timeout already
// present in the connection URL (operator override) wins — this option is
// a no-op in that case.
func WithStatementTimeout(timeout time.Duration) PoolOption {
	return func(cfg *pgxpool.Config) {
		if _, set := cfg.ConnConfig.RuntimeParams["statement_timeout"]; set {
			return
		}
		cfg.ConnConfig.RuntimeParams["statement_timeout"] = strconv.FormatInt(timeout.Milliseconds(), 10)
	}
}

// Match `schema=`/`search_path=` up to the next URL-param separator (`&`),
// fragment (`#`), whitespace, or env-placeholder (`$`). The old `[^$]+` was
// greedy and swallowed every subsequent query param into the schema name.
var schemaRegex = regexp.MustCompile(`(?:search_path|schema)=([^&#\s$]+)`)

func extractSchema(url string) string {
	parts := schemaRegex.FindStringSubmatch(url)
	if len(parts) == 2 {
		return parts[1]
	} else {
		return ""
	}
}

func poolConfig(url string, opts ...PoolOption) (*pgxpool.Config, error) {
	pgCfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("Unable to create postgres connection pool: %v\n", err)
	}
	// pgx forwards unknown URL query params to the server in the startup
	// packet. Prisma-style `?schema=` is not a real server setting, so
	// Postgres aborts the connection with SQLSTATE 42704 unless it's dropped.
	delete(pgCfg.ConnConfig.RuntimeParams, "schema")
	schema := extractSchema(url)
	if schema != "" {
		pgCfg.ConnConfig.RuntimeParams["search_path"] = schema
		pgCfg.AfterConnect = func(ctx context.Context, conn *pgx.Conn) error {
			_, err := conn.Exec(ctx, fmt.Sprintf("SET search_path TO '%s'", schema))
			return err
		}
	}
	for _, opt := range opts {
		opt(pgCfg)
	}
	return pgCfg, nil
}

func NewPGPool(url string, opts ...PoolOption) (*pgxpool.Pool, error) {
	pgCfg, err := poolConfig(url, opts...)
	if err != nil {
		return nil, err
	}
	dbpool, err := pgxpool.NewWithConfig(context.Background(), pgCfg)
	if err != nil {
		return nil, fmt.Errorf("Unable to create postgres connection pool: %v\n", err)
	}
	return dbpool, nil
}
