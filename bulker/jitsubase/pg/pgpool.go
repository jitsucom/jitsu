package pg

import (
	"context"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"regexp"
)

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

func NewPGPool(url string) (*pgxpool.Pool, error) {
	pgCfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("Unable to create postgres connection pool: %v\n", err)
	}
	schema := extractSchema(url)
	if schema != "" {
		pgCfg.ConnConfig.RuntimeParams["search_path"] = schema
		pgCfg.AfterConnect = func(ctx context.Context, conn *pgx.Conn) error {
			_, err := conn.Exec(ctx, fmt.Sprintf("SET search_path TO '%s'", schema))
			return err
		}
	}
	dbpool, err := pgxpool.NewWithConfig(context.Background(), pgCfg)
	if err != nil {
		return nil, fmt.Errorf("Unable to create postgres connection pool: %v\n", err)
	}
	return dbpool, nil
}
