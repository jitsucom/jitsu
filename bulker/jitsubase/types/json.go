package types

import (
	"strings"

	"github.com/jitsucom/bulker/jitsubase/jsonorder"
)

const SqlTypePrefix = "__sql_type"

// sqlTypeHintAllowlist enumerates the __sql_type* hint values allowed through
// s2s ingest, compared case-insensitively (the original casing is passed
// through, which matters for case-sensitive drivers like ClickHouse). The
// hint's only supported use at ingest is mapping a (nested) object to a JSON-
// or string-typed column, so only bare object/string type names are allowed —
// no parameters, no expressions, nothing that could alter generated DDL.
// Richer hints can still be produced by transformation functions downstream.
var sqlTypeHintAllowlist = map[string]bool{
	"json":    true, // Postgres, MySQL, ClickHouse, BigQuery
	"jsonb":   true, // Postgres
	"string":  true, // ClickHouse, BigQuery
	"text":    true,
	"varchar": true,
	"variant": true, // Snowflake
	"object":  true, // Snowflake
	"super":   true, // Redshift
}

type Json = *jsonorder.OrderedMap[string, any]

func NewJson(defaultCapacity int) Json {
	return jsonorder.NewOrderedMap[string, any](defaultCapacity)
}

func JsonFromMap(mp map[string]any) Json {
	om := NewJson(len(mp))
	for k, v := range mp {
		nested, ok := v.(map[string]any)
		if ok {
			om.Set(k, JsonFromMap(nested))
		} else {
			om.Set(k, v)
		}
	}
	return om
}

func JsonFromKV(kv ...any) Json {
	om := NewJson(len(kv) / 2)
	for i := 0; i < len(kv)-1; i += 2 {
		key, ok := kv[i].(string)
		if !ok {
			continue
		}
		om.Set(key, kv[i+1])
	}
	return om
}

func JsonToMap(j Json) map[string]any {
	mp := make(map[string]any, j.Len())
	for el := j.Front(); el != nil; el = el.Next() {
		key := el.Key
		value := el.Value
		js, ok := value.(Json)
		if ok {
			mp[key] = JsonToMap(js)
		} else {
			mp[key] = value
		}
	}
	return mp
}

func FilterEvent(event Json) {
	_ = event.Delete("JITSU_TABLE_NAME")
	_ = event.Delete("JITSU_PROFILE_ID")
	_ = event.Delete("SALESFORCE_OPERATION")
	_ = event.Delete("SALESFORCE_SOBJECT")
	_ = event.Delete("SALESFORCE_MATCHERS_OPERATOR")
	_ = event.Delete("SALESFORCE_MATCHERS")
	_ = event.Delete("SALESFORCE_PAYLOAD")
	filterEvent(event, nil)
}

// SanitizeSqlTypes keeps allowlisted __sql_type* hints and deletes the rest.
// Used on the s2s path, where hints are a supported feature but their values
// end up in SQL DDL: a hint must be a single string from
// sqlTypeHintAllowlist. The [castType, ddlType] array form accepted by
// extractSQLTypesHints in bulkerlib is deliberately not allowed through
// ingest. The event itself is never rejected over a bad hint.
func SanitizeSqlTypes(event Json) {
	filterEvent(event, isValidSqlTypeHint)
}

// keepHint == nil deletes every __sql_type* key; otherwise keys whose value
// fails keepHint are deleted.
func filterEvent(event any, keepHint func(any) bool) {
	switch v := event.(type) {
	case Json:
		for el := v.Front(); el != nil; {
			curEl := el
			// move to the next element before deleting the current one. otherwise iteration will be broken
			el = el.Next()
			if strings.HasPrefix(curEl.Key, SqlTypePrefix) {
				if keepHint == nil || !keepHint(curEl.Value) {
					v.DeleteElement(curEl)
				}
			} else {
				switch v2 := curEl.Value.(type) {
				case Json, []any:
					filterEvent(v2, keepHint)
				}
			}
		}
	case []any:
		for _, a := range v {
			switch v2 := a.(type) {
			case Json, []any:
				filterEvent(v2, keepHint)
			}
		}
	}
}

func isValidSqlTypeHint(v any) bool {
	s, ok := v.(string)
	return ok && sqlTypeHintAllowlist[strings.ToLower(s)]
}
