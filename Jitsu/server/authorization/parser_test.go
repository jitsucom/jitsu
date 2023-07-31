package authorization

import (
	"github.com/jitsucom/jitsu/server/test"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestParseFromBytes(t *testing.T) {
	tests := []struct {
		name        string
		input       []byte
		expected    *TokensHolder
		expectedErr string
	}{
		{
			"Empty input",
			[]byte{},
			nil,
			"Error unmarshalling tokens. Payload must be json with 'tokens' key: unexpected end of JSON input",
		},
		{
			"Wrong json keys format",
			[]byte(`{"tokens":{}}}`),
			nil,
			"Error unmarshalling tokens. Payload must be json with 'tokens' key: invalid character '}' after top-level value",
		},
		{
			"Empty json input",
			[]byte(`{}`),
			&TokensHolder{clientTokensOrigins: map[string][]string{}, serverTokensOrigins: map[string][]string{}, all: map[string]Token{}},
			"",
		},
		{
			"Wrong keys json input",
			[]byte(`{"jsss":[], "apii": []}`),
			&TokensHolder{clientTokensOrigins: map[string][]string{}, serverTokensOrigins: map[string][]string{}, all: map[string]Token{}},
			"",
		},

		{
			"Empty json tokens input",
			[]byte(`{"tokens":[]}`),
			&TokensHolder{clientTokensOrigins: map[string][]string{}, serverTokensOrigins: map[string][]string{}, all: map[string]Token{}},
			"",
		},
		{
			"ok",
			[]byte(`{"tokens":[{"id":"id1","client_secret":"cl_secret1","server_secret":"sr_secret1","origins":["abc.com","rr.ru"]},{"client_secret":"cl_secret2"},{"server_secret":"sr_secret3"}]}`),
			buildExpected(),
			"",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tokens, err := parseFromBytes(tt.input)
			if tt.expectedErr != "" {
				require.EqualError(t, err, tt.expectedErr, "Errors aren't equal")
			} else {
				require.NoError(t, err)
				actualTokenHolder := reformat(tokens)
				test.ObjectsEqual(t, tt.expected.ids, actualTokenHolder.ids, "Token holder ids aren't equal")
				test.ObjectsEqual(t, tt.expected.all, actualTokenHolder.all, "Token holders all aren't equal")
				test.ObjectsEqual(t, tt.expected.clientTokensOrigins, actualTokenHolder.clientTokensOrigins, "Token holders client tokens aren't equal")
				test.ObjectsEqual(t, tt.expected.serverTokensOrigins, actualTokenHolder.serverTokensOrigins, "Token holders server tokens aren't equal")
			}
		})
	}
}

func buildExpected() *TokensHolder {
	token1 := Token{
		ID:           "id1",
		ClientSecret: "cl_secret1",
		ServerSecret: "sr_secret1",
		Origins:      []string{"abc.com", "rr.ru"},
	}
	token2 := Token{
		ID:           "31429624a471b9bdc6d60350c6cfc24d",
		ClientSecret: "cl_secret2",
	}
	token3 := Token{
		ID:           "03f9ed11a0268dd78766686f8f292b7b",
		ServerSecret: "sr_secret3",
	}
	return &TokensHolder{
		clientTokensOrigins: map[string][]string{"cl_secret1": {"abc.com", "rr.ru"}, "cl_secret2": nil},
		serverTokensOrigins: map[string][]string{"sr_secret1": {"abc.com", "rr.ru"}, "sr_secret3": nil},
		ids:                 []string{"id1", "31429624a471b9bdc6d60350c6cfc24d", "03f9ed11a0268dd78766686f8f292b7b"},
		all: map[string]Token{
			"id1":        token1,
			"cl_secret1": token1,
			"sr_secret1": token1,

			"31429624a471b9bdc6d60350c6cfc24d": token2,
			"cl_secret2":                       token2,

			"03f9ed11a0268dd78766686f8f292b7b": token3,
			"sr_secret3":                       token3,
		},
	}
}
