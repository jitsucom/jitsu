package storages

import (
	"testing"

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
			adapters.Table{Name: "test_table", Columns: adapters.Columns{}, PKFields: map[string]bool{}},
		},
		{
			"ok data type",
			schema.BatchHeader{TableName: "test_table", Fields: schema.Fields{"field1": schema.NewField(typing.STRING), "field2": schema.NewField(typing.STRING)}},
			map[string]bool{"field1": true},
			map[typing.DataType]string{typing.STRING: "text"},
			adapters.Table{Name: "test_table", Columns: adapters.Columns{"field1": adapters.Column{SQLType: "text"}, "field2": adapters.Column{SQLType: "text"}},
				PKFields: map[string]bool{"field1": true}},
		},
		{
			"ok SQL suggestion",
			schema.BatchHeader{TableName: "test_table", Fields: schema.Fields{
				"field1": schema.NewFieldWithSQLType(typing.STRING, schema.NewSQLTypeSuggestion("text", map[string]string{PostgresType: "varchar", ClickHouseType: "String"})),
				"field2": schema.NewFieldWithSQLType(typing.STRING, schema.NewSQLTypeSuggestion("text", map[string]string{ClickHouseType: "String2"})),
			}},
			map[string]bool{},
			map[typing.DataType]string{typing.STRING: "text"},
			adapters.Table{Name: "test_table", Columns: adapters.Columns{"field1": adapters.Column{SQLType: "varchar"}, "field2": adapters.Column{SQLType: "text"}},
				PKFields: map[string]bool{}},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tableHelper := NewTableHelper(nil, nil, tt.pkFields, tt.columnTypesMapping, 0, PostgresType)
			actual := tableHelper.MapTableSchema(&tt.input)
			require.Equal(t, tt.expected, *actual, "Tables aren't equal")
		})
	}
}
