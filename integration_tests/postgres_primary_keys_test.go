package integration_tests

import (
	"context"
	"github.com/jitsucom/eventnative/adapters"
	"github.com/jitsucom/eventnative/appconfig"
	"github.com/jitsucom/eventnative/enrichment"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/schema"
	"github.com/jitsucom/eventnative/storages"
	"github.com/jitsucom/eventnative/synchronization"
	"github.com/jitsucom/eventnative/test"
	"github.com/jitsucom/eventnative/typing"
	"github.com/stretchr/testify/require"
	"testing"
)

//Test postgres adapter with primary keys and without (make sure primary keys are deleted)
func TestPrimaryKeyRemoval(t *testing.T) {
	ctx := context.Background()
	container, err := test.NewPostgresContainer(ctx)
	if err != nil {
		t.Fatalf("failed to initialize container: %v", err)
	}
	defer container.Close()

	err = appconfig.Init()
	require.NoError(t, err)

	enrichment.InitDefault()
	dsConfig := &adapters.DataSourceConfig{Host: container.Host, Port: container.Port, Db: container.Database, Schema: container.Schema, Username: container.Username, Password: container.Password, Parameters: map[string]string{"sslmode": "disable"}}
	pg, err := adapters.NewPostgres(ctx, dsConfig, logging.NewQueryLogger("test", nil, nil), map[string]string{})
	require.NoError(t, err)
	require.NotNil(t, pg)

	tableHelperWithPk := storages.NewTableHelper(pg, synchronization.NewInMemoryService([]string{}), map[string]bool{"email": true}, adapters.SchemaToPostgres)

	// all events should be merged as have the same PK value
	tableWithMerge := tableHelperWithPk.MapTableSchema(&schema.BatchHeader{
		TableName: "users",
		Fields:    schema.Fields{"email": schema.NewField(typing.STRING), "name": schema.NewField(typing.STRING)},
	})
	data := map[string]interface{}{"email": "test@domain.com", "name": "AnyName"}

	ensuredWithMerge, err := tableHelperWithPk.EnsureTable("test", tableWithMerge)
	require.NoError(t, err)

	for i := 0; i < 5; i++ {
		err = pg.Insert(ensuredWithMerge, data)
		if err != nil {
			t.Fatal("failed to insert", err)
		}
	}

	rowsUnique, err := container.CountRows("users")
	require.NoError(t, err)
	require.Equal(t, 1, rowsUnique)

	tableHelperWithoutPk := storages.NewTableHelper(pg, synchronization.NewInMemoryService([]string{}), map[string]bool{}, adapters.SchemaToPostgres)
	// all events should be merged as have the same PK value
	table := tableHelperWithoutPk.MapTableSchema(&schema.BatchHeader{
		TableName: "users",
		Fields:    schema.Fields{"email": schema.NewField(typing.STRING), "name": schema.NewField(typing.STRING)},
	})

	ensuredWithoutMerge, err := tableHelperWithoutPk.EnsureTable("test", table)
	require.NoError(t, err)

	for i := 0; i < 5; i++ {
		err = pg.Insert(ensuredWithoutMerge, data)
		if err != nil {
			t.Fatal("failed to insert", err)
		}
	}
	rows, err := container.CountRows("users")
	require.NoError(t, err)
	require.Equal(t, 6, rows)
}
