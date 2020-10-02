package authorization

import (
	"github.com/ksensehq/eventnative/test"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestParseFromBytes(t *testing.T) {
	tests := []struct {
		name        string
		input       []byte
		expectedJs  map[string][]string
		expectedApi map[string][]string
		expectedErr string
	}{
		{
			"Empty input",
			[]byte{},
			nil,
			nil,
			"Error unmarshalling tokens. Payload must be json with 'js' and 'api' keys of json array or string array formats: unexpected end of JSON input",
		},
		{
			"Empty json input",
			[]byte(`{}`),
			map[string][]string{},
			map[string][]string{},
			"",
		},
		{
			"Empty json keys input",
			[]byte(`{"js":[], "api":[]}`),
			map[string][]string{},
			map[string][]string{},
			"",
		},
		{
			"Wrong keys json input",
			[]byte(`{"jsss":[], apii: []}`),
			nil,
			nil,
			"Error unmarshalling tokens. Payload must be json with 'js' and 'api' keys of json array or string array formats: invalid character 'a' looking for beginning of object key string",
		},
		{
			"Wrong json keys format",
			[]byte(`{"js":{}, "api":{}}`),
			nil,
			nil,
			"Error unmarshalling tokens. Payload must be json with 'js' and 'api' keys of json array or string array formats: json: cannot unmarshal object into Go struct field TokensPayload.js of type []interface {}",
		},
		{
			"js strings and api objects",
			[]byte(`{"js":["js1", "js2"], "api":[{"token":"api1", "origins":["origin1"]}]}`),
			map[string][]string{"js1": {}, "js2": {}},
			map[string][]string{"api1": {"origin1"}},
			"",
		},
		{
			"js objects and api strings",
			[]byte(`{"api":["api1", "api2"], "js":[{"token":"js1", "origins":["origin1"]}]}`),
			map[string][]string{"js1": {"origin1"}},
			map[string][]string{"api1": {}, "api2": {}},
			"",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			actualJs, actualApi, err := parseFromBytes(tt.input)
			if tt.expectedErr != "" {
				require.EqualError(t, err, tt.expectedErr, "Errors aren't equal")
			} else {
				require.NoError(t, err)
				test.ObjectsEqual(t, tt.expectedJs, actualJs, "Js tokens and expected tokens aren't equal")
				test.ObjectsEqual(t, tt.expectedApi, actualApi, "Api tokens and expected tokens aren't equal")
			}
		})
	}
}
