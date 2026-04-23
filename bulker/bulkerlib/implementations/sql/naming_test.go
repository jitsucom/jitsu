package sql

import (
	"testing"

	bulker "github.com/jitsucom/bulker/bulkerlib"
	"github.com/jitsucom/bulker/jitsubase/utils"
)

func TestNaming(t *testing.T) {
	t.Parallel()
	tests := []bulkerTestConfig{
		{
			name:                      "naming_test1",
			tableName:                 "Strange Table Name; DROP DATABASE public;",
			modes:                     []bulker.BulkMode{bulker.Batch, bulker.Stream, bulker.ReplaceTable, bulker.ReplacePartition},
			dataFile:                  "test_data/identifiers.ndjson",
			expectPartitionId:         true,
			expectedRowsCount:         1,
			expectedTableCaseChecking: true,
			expectedTable: ExpectedTable{
				Columns: justColumns("id", "name", "_timestamp", "column_c16da609b86c01f16a2c609eac4ccb0c", "column_12b241e808ae6c964a5bb9f1c012e63d", "秒速_センチメートル", "Université Français", "Странное Имя", "Test Name_ DROP DATABASE public_ SELECT 1 from DUAL_", "Test Name", "1test_name", "2", "_unnamed", "lorem_ipsum_dolor_sit_amet_consectetur_adipiscing_elit_sed_do_e", "camelCase", "int", "user", "select", "__ROOT__", "hash", "default", "current_time"),
			},
			configIds: utils.ArrayExcluding(allBulkerConfigs, RedshiftBulkerTypeId+"_serverless", RedshiftBulkerTypeId+"_iam", RedshiftBulkerTypeId, SnowflakeBulkerTypeId, BigqueryBulkerTypeId, ClickHouseBulkerTypeId, ClickHouseBulkerTypeId+"_cluster", ClickHouseBulkerTypeId+"_cluster_noshards", ClickHouseBulkerTypeId+"_replicated_db"),
		},
		{
			name:                      "naming_test1_clickhouse",
			tableName:                 "Strange Table Name; DROP DATABASE public;",
			modes:                     []bulker.BulkMode{bulker.Batch, bulker.Stream, bulker.ReplaceTable, bulker.ReplacePartition},
			dataFile:                  "test_data/identifiers.ndjson",
			expectPartitionId:         true,
			expectedRowsCount:         1,
			expectedTableCaseChecking: true,
			expectedTable: ExpectedTable{
				Columns: justColumns("id", "name", "_timestamp", "column_c16da609b86c01f16a2c609eac4ccb0c", "column_12b241e808ae6c964a5bb9f1c012e63d", "秒速_センチメートル", "Université Français", "Странное Имя", "Test Name_ DROP DATABASE public_ SELECT 1 from DUAL_", "Test Name", "1test_name", "2", "_unnamed", "lorem_ipsum_dolor_sit_amet_consectetur_adipiscing_elit_sed_do_eiusmod_tempor_incididunt_ut_labore_et_dolore_magna_aliqua_ut_eni", "camelCase", "int", "user", "select", "__ROOT__", "hash", "default", "current_time"),
			},
			configIds: []string{ClickHouseBulkerTypeId, ClickHouseBulkerTypeId + "_replicated_db"},
		},
		{
			name:              "naming_test1_case_redshift",
			tableName:         "Strange Table Name; DROP DATABASE public;",
			modes:             []bulker.BulkMode{bulker.Batch, bulker.Stream, bulker.ReplaceTable, bulker.ReplacePartition},
			dataFile:          "test_data/identifiers.ndjson",
			expectPartitionId: true,
			// Redshift is case insensitive by default. During creation it changes all created identifiers to lowercase.
			// Case sensitivity may be enabled on the server side or for a session: https://docs.aws.amazon.com/redshift/latest/dg/r_enable_case_sensitive_identifier.html
			// TODO: consider 'case sensitivity' option for bulker stream
			expectedTableCaseChecking: false,
			expectedRowsCount:         1,
			expectedTable: ExpectedTable{
				Columns: justColumns("id", "name", "_timestamp", "column_c16da609b86c01f16a2c609eac4ccb0c", "column_12b241e808ae6c964a5bb9f1c012e63d", "秒速_センチメートル", "Université Français", "Странное Имя", "Test Name_ DROP DATABASE public_ SELECT 1 from DUAL_", "Test Name", "1test_name", "2", "_unnamed", "lorem_ipsum_dolor_sit_amet_consectetur_adipiscing_elit_sed_do_eiusmod_tempor_incididunt_ut_labore_et_dolore_magna_aliqua_ut_eni", "camelCase", "int", "user", "select", "__ROOT__", "hash", "default", "current_time"),
				//Columns: justColumns("id", "name", "column_12b241e808ae6c964a5bb9f1c012e63d", "1test_name", "2", "column_c16da609b86c01f16a2c609eac4ccb0c", "test name", "test name drop database public select 1 from dual", "université français", "_timestamp", "_unnamed", "lorem_ipsum_dolor_sit_amet_consectetur_adipiscing_elit_sed_do_eiusmod_tempor_incididunt_ut_labore_et_dolore_magna_aliqua_ut_eni", "странное имя", "秒速センチメートル", "camelcase", "int", "user", "select","__root__"),
			},
			configIds: []string{RedshiftBulkerTypeId + "_serverless", RedshiftBulkerTypeId + "_iam", RedshiftBulkerTypeId},
		},
		{
			name:                      "naming_test1_case_snowflake",
			tableName:                 "Strange Table Name; DROP DATABASE public;",
			modes:                     []bulker.BulkMode{bulker.Batch, bulker.Stream, bulker.ReplaceTable},
			dataFile:                  "test_data/identifiers.ndjson",
			expectPartitionId:         true,
			expectedTableCaseChecking: true,
			expectedRowsCount:         1,
			expectedTable: ExpectedTable{
				Columns: justColumns("ID", "NAME", "_TIMESTAMP", "COLUMN_C16DA609B86C01F16A2C609EAC4CCB0C", "COLUMN_12B241E808AE6C964A5BB9F1C012E63D", "秒速_センチメートル", "Université Français", "Странное Имя", "Test Name_ DROP DATABASE public_ SELECT 1 from DUAL_", "Test Name", "1test_name", "2", "_UNNAMED", "LOREM_IPSUM_DOLOR_SIT_AMET_CONSECTETUR_ADIPISCING_ELIT_SED_DO_EIUSMOD_TEMPOR_INCIDIDUNT_UT_LABORE_ET_DOLORE_MAGNA_ALIQUA_UT_ENIM_AD_MINIM_VENIAM_QUIS_NOSTRUD_EXERCITATION_ULLAMCO_LABORIS_NISI_UT_ALIQUIP_EX_EA_COMMODO_CONSEQUAT", "camelCase", "INT", "USER", "SELECT", "__ROOT__", "HASH", "DEFAULT", "_CURRENT_TIME"),
			},
			configIds: []string{SnowflakeBulkerTypeId},
		},
		{
			name:                      "naming_test1_postgres_samecase",
			tableName:                 "StrangeTableName",
			modes:                     []bulker.BulkMode{bulker.ReplaceTable},
			dataFile:                  "test_data/identifiers.ndjson",
			expectedRowsCount:         1,
			expectedTableCaseChecking: true,
			expectedTable: ExpectedTable{
				Name:    "strangetablename_replace_table",
				Columns: justColumns("id", "name", "_timestamp", "column_c16da609b86c01f16a2c609eac4ccb0c", "column_12b241e808ae6c964a5bb9f1c012e63d", "秒速_センチメートル", "université français", "странное имя", "test name_ drop database public_ select 1 from dual_", "test name", "1test_name", "2", "_unnamed", "lorem_ipsum_dolor_sit_amet_consectetur_adipiscing_elit_sed_do_e", "camelcase", "int", "user", "select", "__root__", "hash", "default", "current_time"),
			},
			streamOptions: []bulker.StreamOption{bulker.WithToSameCase()},
			configIds:     []string{PostgresBulkerTypeId},
		},
		{
			name:                      "naming_test1_snowflake_samecase",
			tableName:                 "StrangeTableName",
			modes:                     []bulker.BulkMode{bulker.Batch},
			dataFile:                  "test_data/identifiers.ndjson",
			expectedTableCaseChecking: true,
			expectedRowsCount:         1,
			expectedTable: ExpectedTable{
				Name:    "STRANGETABLENAME_BATCH",
				Columns: justColumns("ID", "NAME", "_TIMESTAMP", "COLUMN_C16DA609B86C01F16A2C609EAC4CCB0C", "COLUMN_12B241E808AE6C964A5BB9F1C012E63D", "秒速_センチメートル", "UNIVERSITÉ FRANÇAIS", "СТРАННОЕ ИМЯ", "TEST NAME_ DROP DATABASE PUBLIC_ SELECT 1 FROM DUAL_", "TEST NAME", "1TEST_NAME", "2", "_UNNAMED", "LOREM_IPSUM_DOLOR_SIT_AMET_CONSECTETUR_ADIPISCING_ELIT_SED_DO_EIUSMOD_TEMPOR_INCIDIDUNT_UT_LABORE_ET_DOLORE_MAGNA_ALIQUA_UT_ENIM_AD_MINIM_VENIAM_QUIS_NOSTRUD_EXERCITATION_ULLAMCO_LABORIS_NISI_UT_ALIQUIP_EX_EA_COMMODO_CONSEQUAT", "CAMELCASE", "INT", "USER", "SELECT", "__ROOT__", "HASH", "DEFAULT", "_CURRENT_TIME"),
			},
			configIds:     []string{SnowflakeBulkerTypeId},
			streamOptions: []bulker.StreamOption{bulker.WithToSameCase()},
		},
		{
			name:                      "naming_test1_case_bigquery",
			tableName:                 "Strange Table Name; DROP DATABASE public;",
			modes:                     []bulker.BulkMode{bulker.Batch, bulker.ReplaceTable, bulker.ReplacePartition},
			dataFile:                  "test_data/identifiers.ndjson",
			expectPartitionId:         true,
			expectedTableCaseChecking: true,
			expectedRowsCount:         1,
			expectedTable: ExpectedTable{
				PKFields: []string{"id"},
				Columns:  justColumns("id", "name", "_timestamp", "column_c16da609b86c01f16a2c609eac4ccb0c", "column_12b241e808ae6c964a5bb9f1c012e63d", "column_b4de5a5c8f92f77af9904705b3f08253", "Universit_Franais", "column_c41d0d6c9ff6db34c6df393bdd283e19", "Test_Name__DROP_DATABASE_public__SELECT_1_from_DUAL_", "Test_Name", "_1test_name", "_2", "_unnamed", "lorem_ipsum_dolor_sit_amet_consectetur_adipiscing_elit_sed_do_eiusmod_tempor_incididunt_ut_labore_et_dolore_magna_aliqua_ut_enim_ad_minim_veniam_quis_nostrud_exercitation_ullamco_laboris_nisi_ut_aliquip_ex_ea_commodo_consequat", "camelCase", "int", "user", "select", "___ROOT__", "hash", "default", "current_time"),
			},
			configIds:     []string{BigqueryBulkerTypeId},
			streamOptions: []bulker.StreamOption{bulker.WithPrimaryKey("id"), bulker.WithDeduplicate()},
		},
		{
			name:              "naming_test2",
			tableName:         "Université Français",
			modes:             []bulker.BulkMode{bulker.Batch},
			dataFile:          "test_data/simple.ndjson",
			expectedRowsCount: 3,
			expectedTable: ExpectedTable{
				Name:    "Université Français_batch",
				Columns: justColumns("_timestamp", "id", "name", "extra"),
			},
			expectedErrors: map[string]any{"create_stream_bigquery_stream": BigQueryAutocommitUnsupported},
			configIds:      allBulkerConfigs,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			runTestConfig(t, tt, testStream)
		})
	}
}
