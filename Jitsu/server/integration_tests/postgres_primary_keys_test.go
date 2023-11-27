package integration_tests

import (
	"context"
	"fmt"
	"github.com/jitsucom/jitsu/server/coordination"
	"testing"

	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/enrichment"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/schema"
	"github.com/jitsucom/jitsu/server/storages"
	"github.com/jitsucom/jitsu/server/telemetry"
	"github.com/jitsucom/jitsu/server/test"
	"github.com/jitsucom/jitsu/server/typing"
	"github.com/spf13/viper"
	"github.com/stretchr/testify/require"
)

//Test postgres adapter with primary keys and without (make sure primary keys are deleted)
func TestPostgresPrimaryKeyRemoval(t *testing.T) {
	telemetry.InitTest()
	viper.Set("server.log.path", "")
	viper.Set("sql_debug_log.ddl.enabled", false)

	ctx := context.Background()
	container, err := test.NewPostgresContainer(ctx)
	if err != nil {
		t.Fatalf("failed to initialize container: %v", err)
	}
	defer container.Close()

	err = appconfig.Init(false, "")
	require.NoError(t, err)

	enrichment.InitDefault("", "", "", "")
	dsConfig := &adapters.DataSourceConfig{Host: container.Host, Port: container.Port, Db: container.Database, Schema: container.Schema, Username: container.Username, Password: container.Password, Parameters: map[string]string{"sslmode": "disable"}}
	pg, err := adapters.NewPostgres(ctx, dsConfig, logging.NewQueryLogger("test", nil, nil), typing.SQLTypes{})
	require.NoError(t, err)
	require.NotNil(t, pg)

	tableHelperWithPk := storages.NewTableHelper(container.Schema, pg, coordination.NewInMemoryService(""), map[string]bool{"email": true}, adapters.SchemaToPostgres, 0, storages.PostgresType)

	// all events should be merged as have the same PK value
	tableWithMerge := tableHelperWithPk.MapTableSchema(&schema.BatchHeader{
		TableName: "users",
		Fields:    schema.Fields{"email": schema.NewField(typing.STRING), "name": schema.NewField(typing.STRING)},
	})
	data := map[string]interface{}{"email": "test@domain.com", "name": "AnyName"}

	ensuredWithMerge, err := tableHelperWithPk.EnsureTableWithCaching("test", tableWithMerge)
	require.NoError(t, err)

	for i := 0; i < 5; i++ {
		err = pg.Insert(adapters.NewBatchInsertContext(ensuredWithMerge, []map[string]interface{}{data}, true, nil))
		if err != nil {
			t.Fatal("failed to bulk insert", err)
		}
	}

	rowsUnique, err := container.CountRows("users")
	require.NoError(t, err)
	require.Equal(t, 1, rowsUnique)

	tableHelperWithoutPk := storages.NewTableHelper(container.Schema, pg, coordination.NewInMemoryService(""), map[string]bool{}, adapters.SchemaToPostgres, 0, storages.PostgresType)
	// all events should be merged as have the same PK value
	table := tableHelperWithoutPk.MapTableSchema(&schema.BatchHeader{
		TableName: "users",
		Fields:    schema.Fields{"email": schema.NewField(typing.STRING), "name": schema.NewField(typing.STRING)},
	})

	ensuredWithoutMerge, err := tableHelperWithoutPk.EnsureTableWithCaching("test", table)
	require.NoError(t, err)

	for i := 0; i < 5; i++ {
		err = pg.Insert(adapters.NewBatchInsertContext(ensuredWithoutMerge, []map[string]interface{}{data}, true, nil))
		if err != nil {
			t.Fatal("failed to bulk insert", err)
		}
	}
	rows, err := container.CountRows("users")
	require.NoError(t, err)
	require.Equal(t, 6, rows)
}

//Test postgres adapter with primary keys which aren't managed by Jitsu
func TestPostgresNotManagedPrimaryKeyRemoval(t *testing.T) {
	telemetry.InitTest()
	viper.Set("server.log.path", "")
	viper.Set("sql_debug_log.ddl.enabled", false)
	destinationID := "test"

	background := context.Background()
	ctx := context.WithValue(background, adapters.CtxDestinationId, destinationID)
	container, err := test.NewPostgresContainer(ctx)
	if err != nil {
		t.Fatalf("failed to initialize container: %v", err)
	}
	defer container.Close()

	err = appconfig.Init(false, "")
	require.NoError(t, err)

	enrichment.InitDefault("", "", "", "")
	dsConfig := &adapters.DataSourceConfig{Host: container.Host, Port: container.Port, Db: container.Database, Schema: container.Schema, Username: container.Username, Password: container.Password, Parameters: map[string]string{"sslmode": "disable"}}
	pg, err := adapters.NewPostgres(ctx, dsConfig, logging.NewQueryLogger(destinationID, nil, nil), typing.SQLTypes{})
	require.NoError(t, err)
	require.NotNil(t, pg)

	tableHelperWithPk := storages.NewTableHelper(container.Schema, pg, coordination.NewInMemoryService(""), map[string]bool{"email": true}, adapters.SchemaToPostgres, 0, storages.PostgresType)

	// users table
	tableBatchHeader := &schema.BatchHeader{
		TableName: "users",
		Fields:    schema.Fields{"email": schema.NewField(typing.STRING), "name": schema.NewField(typing.STRING)},
	}
	//override primary key
	tableWithCustomPrimaryKey := tableHelperWithPk.MapTableSchema(tableBatchHeader)
	tableWithCustomPrimaryKey.PrimaryKeyName = "custom_primary_key"
	tableWithCustomPrimaryKey.PKFields = map[string]bool{"name": true}

	err = pg.CreateTable(tableWithCustomPrimaryKey)
	require.NoError(t, err)

	tableWithMerge := tableHelperWithPk.MapTableSchema(tableBatchHeader)
	name := "AnyName"
	data := map[string]interface{}{"email": "test@domain.com", "name": name}

	ensuredWithMerge, err := tableHelperWithPk.EnsureTableWithCaching(destinationID, tableWithMerge)
	require.NoError(t, err)

	for i := 0; i < 5; i++ {
		data["name"] = fmt.Sprintf("%s_%d", name, i)
		err = pg.Insert(adapters.NewBatchInsertContext(ensuredWithMerge, []map[string]interface{}{data}, true, nil))
		if err != nil {
			t.Fatal("failed to bulk insert", err)
		}
	}

	rowsUnique, err := container.CountRows("users")
	require.NoError(t, err)
	require.Equal(t, 5, rowsUnique)

	//check that Jitsu mustn't delete primary key
	tableHelperWithoutPk := storages.NewTableHelper(container.Schema, pg, coordination.NewInMemoryService(""), map[string]bool{}, adapters.SchemaToPostgres, 0, storages.PostgresType)
	// all events should be merged as have the same PK value
	table := tableHelperWithoutPk.MapTableSchema(&schema.BatchHeader{
		TableName: "users",
		Fields:    schema.Fields{"email": schema.NewField(typing.STRING), "name": schema.NewField(typing.STRING)},
	})

	ensuredWithoutMerge, err := tableHelperWithoutPk.EnsureTableWithCaching(destinationID, table)
	require.NoError(t, err)

	for i := 0; i < 5; i++ {
		data["name"] = fmt.Sprintf("%v_%d", name, i)
		err = pg.Insert(adapters.NewBatchInsertContext(ensuredWithoutMerge, []map[string]interface{}{data}, true, nil))
		if err != nil {
			t.Fatal("failed to bulk insert", err)
		}
	}
	rows, err := container.CountRows("users")
	require.NoError(t, err)
	require.Equal(t, 5, rows)
}
