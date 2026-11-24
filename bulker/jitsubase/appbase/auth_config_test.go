package appbase

import (
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestCheckAuthConfig(t *testing.T) {
	for name, tc := range map[string]struct {
		config Config
		ok     bool
	}{
		"no tokens, no opt-out":       {Config{}, false},
		"no tokens, empty strings":    {Config{AuthTokens: "", RawAuthTokens: ""}, false},
		"no tokens, explicit opt-out": {Config{AuthDisabled: true}, true},
		"raw token":                   {Config{RawAuthTokens: "t"}, true},
		"hashed token":                {Config{AuthTokens: "salt.hash"}, true},
		"both":                        {Config{AuthTokens: "salt.hash", RawAuthTokens: "t"}, true},
		"token and opt-out":           {Config{RawAuthTokens: "t", AuthDisabled: true}, true},
	} {
		t.Run(name, func(t *testing.T) {
			err := checkAuthConfig(tc.config)
			if tc.ok {
				require.NoError(t, err)
			} else {
				require.Error(t, err)
				require.Contains(t, err.Error(), "AUTH_DISABLED")
			}
		})
	}
}

func authStatus(config Config, authorization string) int {
	r := NewRouterBase(config, nil)
	r.Engine().GET("/x", func(c *gin.Context) { c.Status(http.StatusOK) })
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	if authorization != "" {
		req.Header.Set("Authorization", authorization)
	}
	w := httptest.NewRecorder()
	r.Engine().ServeHTTP(w, req)
	return w.Code
}

func TestAuthDisabledOnlyWithoutTokens(t *testing.T) {
	require.Equal(t, http.StatusOK, authStatus(Config{AuthDisabled: true}, ""), "explicitly disabled: open")
	// the opt-out never weakens configured tokens
	cfg := Config{RawAuthTokens: "secret-token", AuthDisabled: true}
	require.Equal(t, http.StatusUnauthorized, authStatus(cfg, ""))
	require.Equal(t, http.StatusUnauthorized, authStatus(cfg, "Bearer wrong"))
	require.Equal(t, http.StatusOK, authStatus(cfg, "Bearer secret-token"))
}

// TestRouterRefusesToStartWithoutTokens runs NewRouterBase with no tokens in a child process, because the refusal is a
// fatal log that ends the process.
func TestRouterRefusesToStartWithoutTokens(t *testing.T) {
	if os.Getenv("APPBASE_TEST_NO_TOKENS") == "1" {
		NewRouterBase(Config{}, nil)
		os.Exit(0) // reached only if the router started
	}
	cmd := exec.Command(os.Args[0], "-test.run=^TestRouterRefusesToStartWithoutTokens$")
	cmd.Env = append(os.Environ(), "APPBASE_TEST_NO_TOKENS=1")
	out, err := cmd.CombinedOutput()
	require.Error(t, err, "the router started without tokens and without AUTH_DISABLED; output: %s", out)
	require.Contains(t, string(out), "AUTH_DISABLED")
}
