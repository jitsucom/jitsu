package integration_tests

import (
	"context"
	"github.com/jitsucom/eventnative/adapters"
	"github.com/jitsucom/eventnative/schema"
	"github.com/jitsucom/eventnative/storages"
	"github.com/jitsucom/eventnative/synchronization"
	"github.com/jitsucom/eventnative/test"
	"github.com/jitsucom/eventnative/typing"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestPrimaryKeyRemoval(t *testing.T) {
	ctx := context.Background()
	container, err := test.NewPostgresContainer(ctx)
	if err != nil {
		t.Fatalf("failed to initialize container: %v", err)
	}
	defer container.Close()
	pgParams := make(map[string]string)
	pgParams["sslmode"] = "disable"

	dsConfig := &adapters.DataSourceConfig{Host: container.Host, Port: container.Port, Db: container.Database, Schema: container.Schema, Username: container.Username, Password: container.Password, Parameters: pgParams}
	processor, err := schema.NewProcessor("users", []string{}, "", map[string]bool{})
	if err != nil {
		panic(err)
	}
	monitor, err := synchronization.NewService(ctx, "test", "", "", 0)
	pg, err := storages.NewPostgres(ctx, dsConfig, processor, nil, "test", true, false, monitor)
	if err != nil {
		require.Fail(t, "failed to initialize", err)
	}
	require.NotNil(t, pg)
	data := make(map[string]interface{})
	data["email"] = "test@domain.com"
	data["name"] = "AnyName"
	columns := make(map[string]schema.Column)
	columns["email"] = schema.NewColumn(typing.STRING)
	columns["name"] = schema.NewColumn(typing.STRING)

	// all events should be merged as have the same PK value
	tableWithMerge := &schema.Table{Name: "users", Version: 1, Columns: columns, PKFields: map[string]bool{"email": true}}
	for i := 0; i < 5; i++ {
		err = pg.Insert(tableWithMerge, data)
		if err != nil {
			t.Fatal("failed to insert", err)
		}
	}
	rowsUnique, err := container.CountRows("users")
	require.NoError(t, err)
	require.Equal(t, 1, rowsUnique)

	// Update schema removing primary keys. Now each event should be stored
	table := &schema.Table{Name: "users", Version: 1, Columns: columns, PKFields: map[string]bool{}}
	for i := 0; i < 5; i++ {
		err = pg.Insert(table, data)
		if err != nil {
			t.Fatal("failed to insert", err)
		}
	}
	rows, err := container.CountRows("users")
	require.NoError(t, err)
	require.Equal(t, 6, rows)
}
