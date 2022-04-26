package storages

import (
	"testing"
	"time"

	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/config"
	"github.com/jitsucom/jitsu/server/enrichment"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/identifiers"
	"github.com/jitsucom/jitsu/server/parsers"
	"github.com/jitsucom/jitsu/server/script/node_old"
	"github.com/jitsucom/jitsu/server/templates"
	"github.com/spf13/viper"

	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/schema"
	"github.com/jitsucom/jitsu/server/typing"
	"github.com/stretchr/testify/require"
)

func TestMapTableSchema(t *testing.T) {
	tests := []struct {
		name               string
		input              schema.BatchHeader
		pkFields           map[string]bool
		columnTypesMapping map[typing.DataType]string
		expected           adapters.Table
	}{
		{
			"Empty configuration => empty result columns",
			schema.BatchHeader{TableName: "test_table", Fields: schema.Fields{"field1": schema.NewField(typing.STRING)}},
			map[string]bool{},
			map[typing.DataType]string{},
			adapters.Table{Schema: "test", Name: "test_table", Columns: adapters.Columns{}, PKFields: map[string]bool{}},
		},
		{
			"ok data type",
			schema.BatchHeader{TableName: "test_table", Fields: schema.Fields{"field1": schema.NewField(typing.STRING), "field2": schema.NewField(typing.STRING)}},
			map[string]bool{"field1": true},
			map[typing.DataType]string{typing.STRING: "text"},
			adapters.Table{Schema: "test", Name: "test_table", Columns: adapters.Columns{"field1": typing.SQLColumn{Type: "text"}, "field2": typing.SQLColumn{Type: "text"}},
				PKFields: map[string]bool{"field1": true}, PrimaryKeyName: "test_test_table_pk"},
		},
		{
			name: "ok SQL suggestion",
			input: schema.BatchHeader{TableName: "test_table", Fields: schema.Fields{
				"field1": schema.NewFieldWithSQLType(typing.STRING, schema.NewSQLTypeSuggestion(typing.SQLColumn{Type: "text"}, map[string]typing.SQLColumn{PostgresType: {Type: "varchar"}, ClickHouseType: {Type: "String"}})),
				"field2": schema.NewFieldWithSQLType(typing.STRING, schema.NewSQLTypeSuggestion(typing.SQLColumn{Type: "text"}, map[string]typing.SQLColumn{ClickHouseType: {Type: "String2"}})),
			}},
			pkFields:           map[string]bool{},
			columnTypesMapping: map[typing.DataType]string{typing.STRING: "text"},
			expected: adapters.Table{Schema: "test", Name: "test_table", Columns: adapters.Columns{"field1": typing.SQLColumn{Type: "varchar", Override: true}, "field2": typing.SQLColumn{Type: "text", Override: true}},
				PKFields: map[string]bool{}},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tableHelper := NewTableHelper("test", nil, nil, tt.pkFields, tt.columnTypesMapping, 0, PostgresType)
			actual := tableHelper.MapTableSchema(&tt.input)
			require.Equal(t, tt.expected, *actual, "Tables aren't equal")
		})
	}
}

func TestProcessTransformWithTypesOverride(t *testing.T) {
	viper.Set("server.log.path", "")
	viper.Set("sql_debug_log.ddl.enabled", false)
	nodeFactory, err := node_old.NewFactory()
	if err != nil {
		t.Fatal(err)
	}

	templates.SetScriptFactory(nodeFactory)

	err = appconfig.Init(false, "")
	require.NoError(t, err)
	stringTime := "2021-10-20T11:13:14.451098Z"
	expectedTime, _ := time.Parse(time.RFC3339Nano, stringTime)
	tests := []struct {
		name            string
		input           map[string]interface{}
		expectedObjects []events.Event
		expectedTables  []adapters.Table
		expectedErr     string
	}{
		{
			"type mapping transform: no mapping",
			map[string]interface{}{"event_type": "site_page", "url": "https://jitsu.com", "field1": "somedata", "number": 22, "float": 11.34, "dter": stringTime, "nested": map[string]interface{}{"number": 0.33}},
			[]events.Event{{"event_type": "site_page", "url": "https://jitsu.com", "field1": "somedata", "number": int64(22), "float": 11.34, "dter": expectedTime, "nested_number": 0.33}},
			[]adapters.Table{{Schema: "test", Name: "events", Columns: adapters.Columns{"dter": typing.SQLColumn{Type: "timestamp"}, "event_type": typing.SQLColumn{Type: "text"}, "field1": typing.SQLColumn{Type: "text"}, "float": typing.SQLColumn{Type: "double precision"}, "nested_number": typing.SQLColumn{Type: "double precision"}, "number": typing.SQLColumn{Type: "bigint"}, "url": typing.SQLColumn{Type: "text"}}, PKFields: map[string]bool{}}},
			"",
		}, {
			"type mapping transform: simple mapping",
			map[string]interface{}{"event_type": "simple", "url": "https://jitsu.com", "field1": "somedata", "number": 22, "float": 11.34, "dter": stringTime, "nested": map[string]interface{}{"number": 33}},
			[]events.Event{{"event_type": "simple", "url": "https://jitsu.com", "field1": "somedata", "number": int64(22), "float": 11.34, "dter": expectedTime, "nested_number": int64(33)}},
			[]adapters.Table{{Schema: "test", Name: "events", Columns: adapters.Columns{"dter": typing.SQLColumn{Type: "timestamp", ColumnType: "timestamp with timezone", Override: true}, "event_type": typing.SQLColumn{Type: "text"}, "field1": typing.SQLColumn{Type: "text"}, "float": typing.SQLColumn{Type: "numeric(38,18)", Override: true}, "nested_number": typing.SQLColumn{Type: "int", Override: true}, "number": typing.SQLColumn{Type: "bigint"}, "url": typing.SQLColumn{Type: "text"}}, PKFields: map[string]bool{}}}, "",
		},
	}
	appconfig.Init(false, "")

	fieldMapper := schema.DummyMapper{}
	transformExpression := `
if ($.event_type == "simple") {
    return {...$,
    __sql_type_dter: ["timestamp", "timestamp with timezone"],
	__sql_type_float: ["numeric(38,18)"],
    nested: {...$.nested,
        __sql_type_number: "int"
    }
    }
}
return $
`
	destination := &config.DestinationConfig{Type: "google_analytics", BreakOnError: false,
		DataLayout: &config.DataLayout{Transform: transformExpression}}
	p, err := schema.NewProcessor("test", destination, false, `events`, fieldMapper, []enrichment.Rule{}, schema.NewFlattener(), schema.NewTypeResolver(), identifiers.NewUniqueID("/eventn_ctx/event_id"), 20, "new", false)
	require.NoError(t, err)
	err = p.InitJavaScriptTemplates()
	require.NoError(t, err)
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			//to get JSON types (json.Number in particular) we get when deserialize received JSON event from HTTP request
			afterJson, err := parsers.ParseInterface(tt.input)
			require.NoError(t, err)

			envelopes, err := p.ProcessEvent(afterJson, false)
			if tt.expectedErr != "" {
				require.Error(t, err)
				require.Equal(t, tt.expectedErr, err.Error())
			} else {
				require.NoError(t, err)
				require.EqualValues(t, len(tt.expectedObjects), len(envelopes), "Number of expected objects doesnt match.")
				tableHelper := NewTableHelper("test", nil, nil, map[string]bool{}, adapters.SchemaToPostgres, 0, PostgresType)
				for i := 0; i < len(envelopes); i++ {
					table := tableHelper.MapTableSchema(envelopes[i].Header)
					actual := envelopes[i].Event
					expected := tt.expectedObjects[i]
					expectedTable := tt.expectedTables[i]

					require.EqualValues(t, expected, actual, "Processed objects aren't equal")
					require.EqualValues(t, &expectedTable, table, "Tables aren't equal")
				}

			}
		})
	}
}
