package authorization

import (
	"github.com/jitsucom/jitsu/server/resources"
	"github.com/spf13/viper"
	"strings"
	"time"
)

//extractTokens returns TokensHolder which can be configured with the following methods:
// 1. array of yaml objects
// 2. string (check extractFromString func):
// 3. array of client secret strings: ["client_secret1", "client_secret2"]
func extractFromViper(viperKey string, reloadEvery time.Duration, service *Service) (bool, []Token, error) {
	//1. array of objects
	var tokenObjects []Token
	if err := viper.UnmarshalKey(viperKey, &tokenObjects); err == nil {
		return false, tokenObjects, nil
	}

	//2. string
	authStr := viper.GetString(viperKey)
	if authStr != "" {
		return extractFromString(authStr, service, reloadEvery)
	}

	//2. strings array (client secrets)
	authArr := viper.GetStringSlice(viperKey)

	var clientTokens []Token
	for _, clientSecret := range authArr {
		clientTokens = append(clientTokens, Token{ClientSecret: clientSecret})
	}

	return false, clientTokens, nil
}

//extractFromString extracts token from:
// 1. http url: http://some_link
// 2. file link: file:///
// 3. raw json: "{tokens: [{},{},{}]}"
// 4. just a client secret string
func extractFromString(authStr string, service *Service, reloadEvery time.Duration) (bool, []Token, error) {
	//1. http url: http://some_link
	if strings.HasPrefix(authStr, "http://") || strings.HasPrefix(authStr, "https://") {
		resources.Watch(serviceName, authStr, resources.LoadFromHTTP, service.updateTokens, reloadEvery)
		return true, nil, nil
	}

	//2. file link: file:///
	if strings.HasPrefix(authStr, "file://") || strings.HasPrefix(authStr, "/") {
		resources.Watch(serviceName, strings.Replace(authStr, "file://", "", 1), resources.LoadFromFile, service.updateTokens, reloadEvery)
		return true, nil, nil
	}

	//3. raw json: "{tokens: [{},{},{}]}"
	if strings.HasPrefix(authStr, "{") && strings.HasSuffix(authStr, "}") {
		tokens, err := parseFromBytes([]byte(authStr))
		return false, tokens, err
	}

	//4. plain token
	return false, []Token{{ClientSecret: authStr}}, nil
}
