package bulkerlib

import (
	"encoding/json"
	"testing"

	"github.com/jitsucom/bulker/bulkerlib/types"
	"github.com/stretchr/testify/require"
)

// The `streamOptions` HTTP/Kafka header is unmarshalled into map[string]any before each
// option is parsed, so the schema option must accept a nested object - not only a string.
func TestSchemaOptionParseFromStreamOptionsHeader(t *testing.T) {
	streamOptionsHeader := `{"schema": {"fields": [{"name": "context_headers", "type": 6}]}}`
	var streamOptions map[string]any
	require.NoError(t, json.Unmarshal([]byte(streamOptionsHeader), &streamOptions))

	opt, err := ParseOption("schema", streamOptions["schema"])
	require.NoError(t, err)

	opts := StreamOptions{}
	opts.Add(opt)
	schema := SchemaOption.Get(&opts)
	require.Equal(t, types.Schema{Fields: []types.SchemaField{{Name: "context_headers", Type: types.JSON}}}, schema)
}

func TestSchemaOptionParseFromString(t *testing.T) {
	opt, err := ParseOption("schema", `{"fields": [{"name": "context_headers", "type": 6}]}`)
	require.NoError(t, err)

	opts := StreamOptions{}
	opts.Add(opt)
	schema := SchemaOption.Get(&opts)
	require.Equal(t, types.Schema{Fields: []types.SchemaField{{Name: "context_headers", Type: types.JSON}}}, schema)
}
