package storages

import (
	"context"
	"fmt"
	"github.com/ksensehq/eventnative/adapters"
	"github.com/ksensehq/eventnative/schema"
)

//Store files to Postgres
//Keeping tables schema state inmemory and update it according to incoming new data
//note: Assume that after any outer changes in db we need to recreate this structure
//for keeping actual db tables schema state
type Postgres struct {
	adapter         *adapters.Postgres
	schemaProcessor *schema.Processor
	tables          map[string]*schema.Table
	breakOnError    bool
}

func NewPostgres(ctx context.Context, config *adapters.DataSourceConfig, processor *schema.Processor, breakOnError bool) (*Postgres, error) {
	adapter, err := adapters.NewPostgres(ctx, config)
	if err != nil {
		return nil, err
	}

	//create db schema if doesn't exist
	err = adapter.CreateDbSchema(config.Schema)
	if err != nil {
		return nil, err
	}

	p := &Postgres{
		adapter:         adapter,
		schemaProcessor: processor,
		tables:          map[string]*schema.Table{},
		breakOnError:    breakOnError,
	}

	return p, nil
}

func (p Postgres) Close() error {
	if err := p.adapter.Close(); err != nil {
		return fmt.Errorf("Error closing postgres datasource: %v", err)
	}

	return nil
}
