package integration_tests

import (
	"context"
	"github.com/jitsucom/jitsu/server/coordination"
	"github.com/jitsucom/jitsu/server/test"
	"github.com/stretchr/testify/require"
	"testing"

	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/enrichment"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/schema"
	"github.com/jitsucom/jitsu/server/storages"
	"github.com/jitsucom/jitsu/server/telemetry"
	"github.com/jitsucom/jitsu/server/typing"
	"github.com/spf13/viper"
)

//Test mySQL adapter with primary keys and without (make sure primary keys aren't deleted)
func TestMySQLPrimaryKeyNotRemoved(t *testing.T) {
	telemetry.InitTest()
	viper.Set("server.log.path", "")
	viper.Set("sql_debug_log.ddl.enabled", false)

	ctx := context.Background()
	container, err := test.NewMySQLContainer(ctx)
	if err != nil {
		t.Fatalf("failed to initialize container: %v", err)
	}
	defer container.Close()

	err = appconfig.Init(false, "")
	require.NoError(t, err)

	enrichment.InitDefault("", "", "", "")
	dsConfig := &adapters.DataSourceConfig{
		Host:       container.Host,
		Port:       container.Port,
		Db:         container.Database,
		Username:   container.Username,
		Password:   container.Password,
		Parameters: map[string]string{"tls": "false"},
	}

	mySQL, err := adapters.NewMySQL(ctx, dsConfig, logging.NewQueryLogger("test", nil, nil), typing.SQLTypes{})
	require.NoError(t, err)
	require.NotNil(t, mySQL)

	tableHelperWithPk := storages.NewTableHelper(container.Database, mySQL, coordination.NewInMemoryService(""), map[string]bool{"email": true}, adapters.SchemaToMySQL, 0, storages.MySQLType)

	// all events should be merged as have the same PK value
	tableWithMerge := tableHelperWithPk.MapTableSchema(&schema.BatchHeader{
		TableName: "users",
		Fields:    schema.Fields{"email": schema.NewField(typing.STRING), "name": schema.NewField(typing.STRING)},
	})
	data := map[string]interface{}{"email": "test@domain.com", "name": "AnyName"}

	ensuredWithMerge, err := tableHelperWithPk.EnsureTableWithCaching("test", tableWithMerge)
	require.NoError(t, err)

	for i := 0; i < 5; i++ {
		err = mySQL.Insert(adapters.NewBatchInsertContext(ensuredWithMerge, []map[string]interface{}{data}, true, nil))
		if err != nil {
			t.Fatal("failed to bulk insert", err)
		}
	}

	rowsUnique, err := container.CountRows("users")
	require.NoError(t, err)
	require.Equal(t, 1, rowsUnique)

	tableHelperWithoutPk := storages.NewTableHelper(container.Database, mySQL, coordination.NewInMemoryService(""), map[string]bool{}, adapters.SchemaToMySQL, 0, storages.MySQLType)
	// all events should be merged as have the same PK value
	table := tableHelperWithoutPk.MapTableSchema(&schema.BatchHeader{
		TableName: "users",
		Fields:    schema.Fields{"email": schema.NewField(typing.STRING), "name": schema.NewField(typing.STRING)},
	})

	_, err = tableHelperWithoutPk.EnsureTableWithCaching("test", table)
	require.Error(t, err)
	require.Contains(t, err.Error(), "Jitsu can't manage MySQL primary key")
}
