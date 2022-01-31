package authorization

import (
	"bytes"
	"github.com/jarcoal/httpmock"
	"github.com/jitsucom/jitsu/server/test"
	"github.com/spf13/viper"
	"github.com/stretchr/testify/require"
	"testing"
)

//TestNewService tests Authorization service creation from different config structures. See extractor.go
func TestNewService(t *testing.T) {
	httpmock.Activate()
	defer httpmock.DeactivateAndReset()

	tests := []struct {
		name                       string
		viperInitFuncConfiguration func() error
		configuratorURL            string
		configuratorToken          string
		expectedTokensHolder       *TokensHolder
		expectedErr                string
	}{
		{
			"Empty input config",
			initViperEmpty,
			"",
			"",
			&TokensHolder{
				clientTokensOrigins: map[string][]string{},
				serverTokensOrigins: map[string][]string{},
				all:                 map[string]Token{},
			},
			"",
		},
		{
			"Empty input config but with configurator url",
			initConfiguratorURL,
			"https://configurator_url",
			"cluster_token",
			expectedResult(),
			"",
		},
		{
			"array of objects",
			initViperArrayOfObjects,
			"configurator_url",
			"configurator_token",
			expectedResult(),
			"",
		},
		{
			"http URL",
			initViperURL,
			"configurator_url",
			"configurator_token",
			expectedResult(),
			"",
		},
		{
			"file",
			initViperFile,
			"configurator_url",
			"configurator_token",
			expectedResult(),
			"",
		},
		{
			"raw json in viper config",
			initViperRawJson,
			"configurator_url",
			"configurator_token",
			expectedResult(),
			"",
		},
		{
			"single client token",
			initViperSingleToken,
			"configurator_url",
			"configurator_token",
			&TokensHolder{
				clientTokensOrigins: map[string][]string{"clientsecret1": nil},
				serverTokensOrigins: map[string][]string{},
				ids:                 []string{"c78b13487b9a1a3ad951b2952adab4ae"},
				all: map[string]Token{
					"c78b13487b9a1a3ad951b2952adab4ae": {
						ID:           "c78b13487b9a1a3ad951b2952adab4ae",
						ClientSecret: "clientsecret1",
					},
					"clientsecret1": {
						ID:           "c78b13487b9a1a3ad951b2952adab4ae",
						ClientSecret: "clientsecret1",
					},
				},
			},
			"",
		},
		{
			"single client token with deprecated server auth",
			initViperSingleTokenWithServer,
			"configurator_url",
			"configurator_token",
			&TokensHolder{
				clientTokensOrigins: map[string][]string{"clientsecret1": nil},
				serverTokensOrigins: map[string][]string{"server1": nil, "server2": nil},
				ids:                 []string{"c78b13487b9a1a3ad951b2952adab4ae", "a8438da78e679f44a5cff9e44ebacfbd", "194f9987498c1cf5a795d83caa147814"},
				all: map[string]Token{
					"c78b13487b9a1a3ad951b2952adab4ae": {
						ID:           "c78b13487b9a1a3ad951b2952adab4ae",
						ClientSecret: "clientsecret1",
					},
					"clientsecret1": {
						ID:           "c78b13487b9a1a3ad951b2952adab4ae",
						ClientSecret: "clientsecret1",
					},
					"194f9987498c1cf5a795d83caa147814": {
						ID:           "194f9987498c1cf5a795d83caa147814",
						ServerSecret: "server2",
					},
					"a8438da78e679f44a5cff9e44ebacfbd": {
						ID:           "a8438da78e679f44a5cff9e44ebacfbd",
						ServerSecret: "server1",
					},
					"server1": {
						ID:           "a8438da78e679f44a5cff9e44ebacfbd",
						ServerSecret: "server1"},
					"server2": {
						ID:           "194f9987498c1cf5a795d83caa147814",
						ServerSecret: "server2",
					},
				},
			},
			"",
		},
		{
			"client secrets array",
			initViperArrayOfClientSecretStrings,
			"configurator_url",
			"configurator_token",
			&TokensHolder{
				clientTokensOrigins: map[string][]string{"clientsecret1": nil, "clientsecret2": nil},
				serverTokensOrigins: map[string][]string{},
				ids:                 []string{"c78b13487b9a1a3ad951b2952adab4ae", "c3600cb96ade6678e343924ca2030928"},
				all: map[string]Token{
					"c78b13487b9a1a3ad951b2952adab4ae": {
						ID:           "c78b13487b9a1a3ad951b2952adab4ae",
						ClientSecret: "clientsecret1",
					},
					"clientsecret1": {
						ID:           "c78b13487b9a1a3ad951b2952adab4ae",
						ClientSecret: "clientsecret1",
					},
					"c3600cb96ade6678e343924ca2030928": {
						ID:           "c3600cb96ade6678e343924ca2030928",
						ClientSecret: "clientsecret2",
					},
					"clientsecret2": {
						ID:           "c3600cb96ade6678e343924ca2030928",
						ClientSecret: "clientsecret2",
					},
				},
			},
			"",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			initDefaultViperValues()

			err := tt.viperInitFuncConfiguration()
			require.NoError(t, err, "error viper init")

			actual, err := NewService(tt.configuratorURL, tt.configuratorToken)
			if tt.expectedErr != "" {
				require.EqualError(t, err, tt.expectedErr, "Errors aren't equal")
			} else {
				require.NoError(t, err)

				test.ObjectsEqual(t, tt.expectedTokensHolder.ids, actual.tokensHolder.ids, "Token holder ids aren't equal")
				test.ObjectsEqual(t, tt.expectedTokensHolder.all, actual.tokensHolder.all, "Token holders all aren't equal")
				test.ObjectsEqual(t, tt.expectedTokensHolder.clientTokensOrigins, actual.tokensHolder.clientTokensOrigins, "Token holders client tokens aren't equal")
				test.ObjectsEqual(t, tt.expectedTokensHolder.serverTokensOrigins, actual.tokensHolder.serverTokensOrigins, "Token holders server tokens aren't equal")
			}

			viper.Reset()
		})
	}
}

func initDefaultViperValues() {
	viper.SetConfigType("yaml")
	viper.SetDefault("server.api_keys_reload_sec", 1)
	viper.SetDefault("server.strict_auth_tokens", true)
}

func initViperEmpty() error {
	return viper.ReadConfig(bytes.NewBuffer([]byte("")))
}

//array of yaml objects
func initViperArrayOfObjects() error {
	cfg := []byte(`
api_keys:
  -  id: 1
     client_secret: csecret1
     server_secret: ssecret1
  -  id: 2
     client_secret: csecret2
     server_secret: ssecret2
`)
	return viper.ReadConfig(bytes.NewBuffer(cfg))
}

//url
func initViperURL() error {
	resp := httpmock.NewStringResponse(200, `{"tokens":[{"id": "1", "client_secret": "csecret1", "server_secret": "ssecret1"},{"id": "2", "client_secret": "csecret2", "server_secret": "ssecret2"}]}`)
	resp.Header.Add("content-type", "application/json")
	responder := httpmock.ResponderFromResponse(resp)
	httpmock.RegisterResponder("GET", "https://tokens_via_url", responder)

	cfg := []byte(`
api_keys: 'https://tokens_via_url'`)
	return viper.ReadConfig(bytes.NewBuffer(cfg))
}

//file
func initViperFile() error {
	cfg := []byte(`
api_keys: 'file://test_data/auth.json'`)
	return viper.ReadConfig(bytes.NewBuffer(cfg))
}

//raw json
func initViperRawJson() error {
	cfg := []byte(`
server:
  auth: '{"tokens":[{"id": "1", "client_secret": "csecret1", "server_secret": "ssecret1"},{"id": "2", "client_secret": "csecret2", "server_secret": "ssecret2"}]}'`)
	return viper.ReadConfig(bytes.NewBuffer(cfg))
}

//single client secret
func initViperSingleToken() error {
	cfg := []byte(`
server:
  api_keys: 'clientsecret1'`)
	return viper.ReadConfig(bytes.NewBuffer(cfg))
}

//single client secret with deprecated server auth
func initViperSingleTokenWithServer() error {
	cfg := []byte(`
server:
  s2s_auth: ['server1', 'server2']
  api_keys: 'clientsecret1'`)
	return viper.ReadConfig(bytes.NewBuffer(cfg))
}

//array of client secret strings
func initViperArrayOfClientSecretStrings() error {
	cfg := []byte(`
api_keys:
  -  clientsecret1
  -  clientsecret2
`)
	return viper.ReadConfig(bytes.NewBuffer(cfg))
}

func initConfiguratorURL() error {
	resp := httpmock.NewStringResponse(200, `{"tokens":[{"id": "1", "client_secret": "csecret1", "server_secret": "ssecret1"},{"id": "2", "client_secret": "csecret2", "server_secret": "ssecret2"}]}`)
	resp.Header.Add("content-type", "application/json")
	responder := httpmock.ResponderFromResponse(resp)
	httpmock.RegisterResponder("GET", "https://configurator_url/api/v1/apikeys?token=cluster_token", responder)
	return nil
}

func expectedResult() *TokensHolder {
	return &TokensHolder{
		clientTokensOrigins: map[string][]string{"csecret1": nil, "csecret2": nil},
		serverTokensOrigins: map[string][]string{"ssecret1": nil, "ssecret2": nil},
		all: map[string]Token{"1": {
			ID:           "1",
			ClientSecret: "csecret1",
			ServerSecret: "ssecret1",
		},
			"2": {
				ID:           "2",
				ClientSecret: "csecret2",
				ServerSecret: "ssecret2",
			},
			"csecret1": {
				ID:           "1",
				ClientSecret: "csecret1",
				ServerSecret: "ssecret1",
			},
			"csecret2": {
				ID:           "2",
				ClientSecret: "csecret2",
				ServerSecret: "ssecret2",
			},
			"ssecret1": {
				ID:           "1",
				ClientSecret: "csecret1",
				ServerSecret: "ssecret1",
			}, "ssecret2": {
				ID:           "2",
				ClientSecret: "csecret2",
				ServerSecret: "ssecret2"},
		},
		ids: []string{"1", "2"},
	}
}
