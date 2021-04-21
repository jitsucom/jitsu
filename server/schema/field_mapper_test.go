package schema

import (
	"github.com/jitsucom/jitsu/server/test"
	"github.com/jitsucom/jitsu/server/typing"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestOldStyleMap(t *testing.T) {
	tests := []struct {
		name           string
		mappings       []string
		inputObject    map[string]interface{}
		expectedObject map[string]interface{}
		expectedErr    string
	}{
		{
			"nil input object",
			nil,
			nil,
			nil,
			"",
		},
		{
			"Empty mappings and input object",
			nil,
			map[string]interface{}{},
			map[string]interface{}{},
			"",
		},
		{
			"Dummy mapper doesn't change input json",
			nil,
			map[string]interface{}{
				"key1": map[string]interface{}{
					"subkey1": 123,
				},
				"key2": "value",
			},
			map[string]interface{}{
				"key1": map[string]interface{}{
					"subkey1": 123,
				},
				"key2": "value",
			},
			"",
		},
		{
			"Map unflatten object error",
			[]string{
				"/key1 -> /key10",
				"/key2/subkey2-> /key11",
				"/key4/subkey1 ->",
				"/key4/subkey3 ->",
				"/key4/subkey4 -> /key4",
				"/key5 -> /key6/subkey1",
				"/key3/subkey1 -> /key7",
				"/key3 -> /key2/subkey1",
			},
			map[string]interface{}{
				"key1": map[string]interface{}{
					"subkey1": map[string]interface{}{
						"subsubkey1": 123,
						"subsubkey2": 123,
					},
				},
				"key2": "value",
				"key3": 999,
				"key4": map[string]interface{}{
					"subkey1": map[string]interface{}{
						"subsubkey1": 123,
						"subsubkey2": 123,
					},
					"subkey2": 123,
				},
				"key5": 888,
			},
			map[string]interface{}{
				"key10": map[string]interface{}{
					"subkey1": map[string]interface{}{
						"subsubkey1": 123,
						"subsubkey2": 123,
					},
				},
				"key2": "value",
				"key3": 999,
				"key4": map[string]interface{}{
					"subkey2": 123,
				},
				"key6": map[string]interface{}{
					"subkey1": 888,
				},
			},
			"Value 999 wasn't set into /key2/subkey1: key2 node isn't an object",
		},
		{
			"Map unflatten object ok",
			[]string{
				"/key1 -> /key10",
				"/key2/subkey2-> /key11",
				"/key4/subkey1 ->",
				"/key4/subkey3 ->",
				"/key4/subkey4 -> /key4",
				"/key5 -> /key6/subkey1",
				"/key3/subkey1 -> /key7",
			},
			map[string]interface{}{
				"key1": map[string]interface{}{
					"subkey1": map[string]interface{}{
						"subsubkey1": 123,
						"subsubkey2": 123,
					},
				},
				"key2": "value",
				"key3": 999,
				"key4": map[string]interface{}{
					"subkey1": map[string]interface{}{
						"subsubkey1": 123,
						"subsubkey2": 123,
					},
					"subkey2": 123,
				},
				"key5": 888,
			},
			map[string]interface{}{
				"key10": map[string]interface{}{
					"subkey1": map[string]interface{}{
						"subsubkey1": 123,
						"subsubkey2": 123,
					},
				},
				"key2": "value",
				"key3": 999,
				"key4": map[string]interface{}{
					"subkey2": 123,
				},
				"key6": map[string]interface{}{
					"subkey1": 888,
				},
			},
			"",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mappings, err := ConvertOldMappings(Default, tt.mappings)
			require.NoError(t, err)

			mapper, _, err := NewFieldMapper(mappings)
			require.NoError(t, err)

			actualObject, err := mapper.Map(tt.inputObject)
			if tt.expectedErr != "" {
				require.Error(t, err)
				require.Equal(t, tt.expectedErr, err.Error())
			} else {
				require.NoError(t, err)
				test.ObjectsEqual(t, tt.expectedObject, actualObject, "Mapped objects aren't equal")
			}
		})
	}
}

func TestOldStyleStrictMap(t *testing.T) {
	tests := []struct {
		name           string
		mappings       []string
		inputObject    map[string]interface{}
		expectedObject map[string]interface{}
	}{
		{
			"nil input object",
			nil,
			nil,
			nil,
		},
		{
			"Empty mappings and input object",
			nil,
			map[string]interface{}{},
			map[string]interface{}{},
		},
		{
			"Dummy mapper doesn't change input json",
			nil,
			map[string]interface{}{
				"key1": map[string]interface{}{
					"subkey1": 123,
				},
				"key2": "value",
			},
			map[string]interface{}{
				"key1": map[string]interface{}{
					"subkey1": 123,
				},
				"key2": "value",
			},
		},
		{
			"Map unflatten object",
			[]string{"/key1 -> /key10", "/key2/subkey2-> /key11", "/key4/subkey1 ->", "/key4/subkey3 ->",
				"/key4/subkey4 -> /key4", "/key5 -> /key6/subkey1", "/key3/subkey1 -> /key7", "/key3 -> /key2/subkey1"},
			map[string]interface{}{
				"key1": map[string]interface{}{
					"subkey1": map[string]interface{}{
						"subsubkey1": 123,
						"subsubkey2": 123,
					},
				},
				"key2": "value",
				"key3": 999,
				"key4": map[string]interface{}{
					"subkey1": map[string]interface{}{
						"subsubkey1": 123,
						"subsubkey2": 123,
					},
					"subkey2": 123,
				},
				"key5": 888,
			},
			map[string]interface{}{
				"key10": map[string]interface{}{
					"subkey1": map[string]interface{}{
						"subsubkey1": 123,
						"subsubkey2": 123,
					},
				},
				"key2": map[string]interface{}{
					"subkey1": 999,
				},
				"key6": map[string]interface{}{
					"subkey1": 888,
				},
			},
		},
		{
			"Minify object test",
			[]string{"/key1 -> /key10", "/key2-> /key11", "/key3->/key12"},
			map[string]interface{}{
				"src": "api",
				"key1": map[string]interface{}{
					"subkey1": map[string]interface{}{
						"subsubkey1": 123,
						"subsubkey2": 123,
					},
				},
				"key2": "value",
				"key3": 999,
				"key4": map[string]interface{}{
					"subkey1": map[string]interface{}{
						"subsubkey1": 123,
						"subsubkey2": 123,
					},
					"subkey2": 123,
				},
				"key5": 888,
			},
			map[string]interface{}{
				"key10": map[string]interface{}{
					"subkey1": map[string]interface{}{
						"subsubkey1": 123,
						"subsubkey2": 123,
					},
				},
				"key11": "value",
				"key12": 999,
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mappings, err := ConvertOldMappings(Strict, tt.mappings)
			require.NoError(t, err)

			mapper, _, err := NewFieldMapper(mappings)
			require.NoError(t, err)

			actualObject, _ := mapper.Map(tt.inputObject)
			require.NoError(t, err)
			test.ObjectsEqual(t, tt.expectedObject, actualObject, "Mapped objects aren't equal")
		})
	}
}

func TestNewStyleStrictMap(t *testing.T) {
	tests := []struct {
		name           string
		mappings       []MappingField
		inputObject    map[string]interface{}
		expectedObject map[string]interface{}
	}{
		{
			"nil input object",
			nil,
			nil,
			nil,
		},
		{
			"Empty mappings and input object",
			nil,
			map[string]interface{}{},
			map[string]interface{}{},
		},
		{
			"Dummy mapper doesn't change input json",
			nil,
			map[string]interface{}{
				"key1": map[string]interface{}{
					"subkey1": 123,
				},
				"key2": "value",
			},
			map[string]interface{}{
				"key1": map[string]interface{}{
					"subkey1": 123,
				},
				"key2": "value",
			},
		},
		{
			"Map unflatten object",
			[]MappingField{
				{Src: "/key1", Dst: "/key10", Action: MOVE},
				{Src: "/key1", Dst: "/key20", Action: MOVE},
				{Src: "/key2/subkey2", Dst: "/key11", Action: MOVE},
				{Src: "/key4/subkey1", Action: REMOVE},
				{Src: "/key4/subkey3", Action: REMOVE},
				{Src: "/key4/subkey4", Dst: "/key4", Action: MOVE},
				{Src: "/key5", Dst: "/key6/subkey1", Action: MOVE},
				{Src: "/key3/subkey1", Dst: "/key7", Action: MOVE},
				{Src: "/key3", Dst: "/key2_subkey1", Action: MOVE},
				{Dst: "/key10/subkey1/subsubkey1", Action: CAST, Type: "date"},
			},
			map[string]interface{}{
				"key1": map[string]interface{}{
					"subkey1": map[string]interface{}{
						"subsubkey1": 123,
						"subsubkey2": 123,
					},
				},
				"key2": "value",
				"key3": 999,
				"key4": map[string]interface{}{
					"subkey1": map[string]interface{}{
						"subsubkey1": 123,
						"subsubkey2": 123,
					},
					"subkey2": 123,
				},
				"key5": 888,
			},
			map[string]interface{}{
				"key10": map[string]interface{}{
					"subkey1": map[string]interface{}{
						"subsubkey1": 123,
						"subsubkey2": 123,
					},
				},
				"key20": map[string]interface{}{
					"subkey1": map[string]interface{}{
						"subsubkey1": 123,
						"subsubkey2": 123,
					},
				},
				"key2_subkey1": 999,
				"key6": map[string]interface{}{
					"subkey1": 888,
				},
			},
		},
		{
			"Map real event",
			[]MappingField{
				{Src: "/src", Dst: "/channel", Action: MOVE},
				{Src: "/eventn_ctx/event_id", Dst: "/eventn_ctx/event_id", Action: MOVE},
				{Src: "/eventn_ctx/event_id", Dst: "/id", Action: MOVE},
				{Src: "/_timestamp", Dst: "/_timestamp", Action: MOVE},
				{Src: "/_timestamp", Dst: "/timestamp", Action: MOVE},
			},
			map[string]interface{}{
				"_timestamp": "2020-10-26T09:43:47.374118Z",
				"api_key":    "key",
				"src":        "eventn",
				"event_type": "pages",
				"eventn_ctx": map[string]interface{}{
					"event_id": "0001",
					"ids": map[string]interface{}{
						"ajs_anonymous_id": "123",
					},
				},
			},
			map[string]interface{}{
				"_timestamp": "2020-10-26T09:43:47.374118Z",
				"channel":    "eventn",
				"eventn_ctx": map[string]interface{}{
					"event_id": "0001",
				},
				"id":        "0001",
				"timestamp": "2020-10-26T09:43:47.374118Z",
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			for _, field := range tt.mappings {
				require.NoError(t, field.Validate())
			}
			f := false
			mapper, _, err := NewFieldMapper(&Mapping{KeepUnmapped: &f, Fields: tt.mappings})
			require.NoError(t, err)

			actualObject, _ := mapper.Map(tt.inputObject)
			require.NoError(t, err)
			test.ObjectsEqual(t, tt.expectedObject, actualObject, "Mapped objects aren't equal")
		})
	}
}

func TestTypecasts(t *testing.T) {
	tests := []struct {
		name     string
		mappings []MappingField
		expected typing.SQLTypes
	}{
		{
			"Empty mappings and typecasts",
			nil,
			typing.SQLTypes{},
		},
		{
			"Typecasts present",
			[]MappingField{
				{Src: "/key1", Dst: "/key10", Action: MOVE, Type: "varchar(256)"},
				{Src: "/key1", Dst: "/key11", Action: MOVE, Type: "varchar(256)", ColumnType: "varchar(256) encode zstd"},
				{Src: "/key1", Dst: "/key12", Action: MOVE, ColumnType: "varchar(256) encode zstd"},
				{Src: "/key1", Dst: "/key13", Action: MOVE},
			},
			typing.SQLTypes{
				"key10": typing.SQLColumn{
					Type:       "varchar(256)",
					ColumnType: "varchar(256)",
				},
				"key11": typing.SQLColumn{
					Type:       "varchar(256)",
					ColumnType: "varchar(256) encode zstd",
				},
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			for _, field := range tt.mappings {
				require.NoError(t, field.Validate())
			}
			f := false
			_, sqlTypeCasts, err := NewFieldMapper(&Mapping{KeepUnmapped: &f, Fields: tt.mappings})
			require.NoError(t, err)

			test.ObjectsEqual(t, tt.expected, sqlTypeCasts, "SQL typecasts aren't equal")
		})
	}
}
