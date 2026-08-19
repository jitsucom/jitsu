package types

import (
	"strings"
	"testing"

	"github.com/jitsucom/bulker/jitsubase/jsonorder"
	"github.com/stretchr/testify/require"
)

const jDirty = `{
  "JITSU_TABLE_NAME": "blabla",
  "type": "track",
  "__sql_type_type": "blabla",
  "event": "test",
  "properties": {
    "title": "Jitsu : ABC",
	"__sql_type_title": "blabla",
    "url": "https://jitsu.com/abc?utm_source=campaign",
    "path": "/start?utm_source=campaign",
    "hash": "",
    "search": "",
    "currency": "USD",
    "width": 1458,
    "height": 1186,
    "newCol1": 1,
    "newCol2": 2
  },
  "anonymousId": "anon_6",
  "context": {
    "library": {
      "name": "@jitsu/js",
      "version": "2.0.1",
      "nested": {
        "zzz": 999,
        "yyy": 888,
        "xxx": 777,
        "kkk": 555,
        "aaa": 111,
        "__sql_type": "blabla"
      },
      "arr1": [1,2,3,4,6],
      "arr2": [{
        "a": 1, "b": 2, "c": 3, "__sql_type_c": "blabla"
      },{
        "x": 1, "y": 2, "z": 3
      }]
    }
  }
}`

const j = `{
  "type": "track",
  "event": "test",
  "properties": {
    "title": "Jitsu : ABC",
    "url": "https://jitsu.com/abc?utm_source=campaign",
    "path": "/start?utm_source=campaign",
    "hash": "",
    "search": "",
    "currency": "USD",
    "width": 1458,
    "height": 1186,
    "newCol1": 1,
    "newCol2": 2
  },
  "anonymousId": "anon_6",
  "context": {
    "library": {
      "name": "@jitsu/js",
      "version": "2.0.1",
      "nested": {
        "zzz": 999,
        "yyy": 888,
        "xxx": 777,
        "kkk": 555,
        "aaa": 111
      },
      "arr1": [1,2,3,4,6],
      "arr2": [{
        "a": 1, "b": 2, "c": 3
      },{
        "x": 1, "y": 2, "z": 3
      }]
    }
  }
}`

const expectedJson = `{"type":"track","event":"test","properties":{"title":"Jitsu : ABC","url":"https://jitsu.com/abc?utm_source=campaign","path":"/start?utm_source=campaign","hash":"","search":"","currency":"USD","width":1458,"height":1186,"newCol1":1,"newCol2":2},"anonymousId":"anon_6","context":{"library":{"name":"@jitsu/js","version":"2.0.1","nested":{"zzz":999,"yyy":888,"xxx":777,"kkk":555,"aaa":111},"arr1":[1,2,3,4,6],"arr2":[{"a":1,"b":2,"c":3},{"x":1,"y":2,"z":3}]}}}`

func TestEventFilter(t *testing.T) {
	var obj *jsonorder.OrderedMap[string, any]
	_ = jsonorder.Unmarshal([]byte(jDirty), &obj)
	t.Log(obj.GetS("__sql_type_type"))
	FilterEvent(obj)
	ja, err := jsonorder.Marshal(obj)
	require.NoError(t, err)
	t.Logf("JSON: %s", ja)
	require.Equal(t, expectedJson, string(ja))
	require.JSONEq(t, j, string(ja))
}

const jHints = `{
  "type": "track",
  "event": "test",
  "__sql_type_type": "VARCHAR(255)",
  "__sql_type_bad": "TEXT); DROP TABLE users;--",
  "properties": {
    "__sql_type_": "JSON",
    "__sql_type_ts": "TIMESTAMP WITH TIME ZONE",
    "__sql_type_arr": ["DateTime64(3)", "Nullable(DateTime64(3))"],
    "__sql_type_arr1": ["DateTime64(3)"],
    "__sql_type_quoted": "Enum8('a'=1)",
    "__sql_type_num": 42,
    "__sql_type_long_arr": ["a", "b", "c"],
    "title": "Jitsu"
  },
  "context": {
    "nested": [{
      "__sql_type_ok": "ARRAY<STRING>",
      "__sql_type_comment": "TEXT /* x */",
      "a": 1
    }]
  }
}`

const jHintsSanitized = `{"type":"track","event":"test","__sql_type_type":"VARCHAR(255)","properties":{"__sql_type_":"JSON","__sql_type_ts":"TIMESTAMP WITH TIME ZONE","title":"Jitsu"},"context":{"nested":[{"__sql_type_ok":"ARRAY<STRING>","a":1}]}}`

func TestSanitizeSqlTypes(t *testing.T) {
	var obj *jsonorder.OrderedMap[string, any]
	require.NoError(t, jsonorder.Unmarshal([]byte(jHints), &obj))
	SanitizeSqlTypes(obj)
	ja, err := jsonorder.Marshal(obj)
	require.NoError(t, err)
	t.Logf("JSON: %s", ja)
	require.Equal(t, jHintsSanitized, string(ja))
}

func TestIsValidSqlTypeHint(t *testing.T) {
	valid := []any{
		"JSON",
		"VARCHAR(255)",
		"NUMERIC(10,2)",
		"TIMESTAMP WITH TIME ZONE",
		"TIMESTAMP_NTZ",
		"LowCardinality(String)",
		"ARRAY<STRING>",
	}
	for _, v := range valid {
		require.True(t, isValidSqlTypeHint(v), "expected valid: %v", v)
	}
	invalid := []any{
		"TEXT); DROP TABLE users;--",
		"Enum8('a'=1)",
		`STRING"`,
		"TEXT /* comment */",
		"TEXT; SELECT 1",
		" JSON",
		"1NT",
		"",
		strings.Repeat("A", 129),
		42,
		true,
		nil,
		// the [castType, ddlType] array form is not allowed through ingest
		[]any{},
		[]any{"DateTime64(3)"},
		[]any{"DateTime64(3)", "Nullable(DateTime64(3))"},
		[]any{"JSON", "JSON", "JSON"},
		[]any{42},
		[]any{"JSON", 42},
	}
	for _, v := range invalid {
		require.False(t, isValidSqlTypeHint(v), "expected invalid: %v", v)
	}
	// boundary: exactly 128 chars is allowed
	require.True(t, isValidSqlTypeHint(strings.Repeat("A", 128)))
}
