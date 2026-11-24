package appbase

import (
	"crypto/sha256"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/jitsucom/bulker/jitsubase/logging"
	"github.com/jitsucom/bulker/jitsubase/uuid"
	"github.com/stretchr/testify/require"
)

// test HashTokenHex function of router
func TestHashToken(t *testing.T) {
	token := "21a2ae36-32994870a9fbf2f61ea6f6c8"
	salt := uuid.New()
	secret := "dea42a58-acf4-45af-85bb-e77e94bd5025"
	hashedToken := HashTokenHex(token, salt, secret)
	logging.Infof("hashedToken: %s.%s", salt, hashedToken)
}

// The compare of a token with the configured ones must not stop at the first different byte: how long it takes would tell a
// caller how many leading bytes of a token were right.

func testRouter(t *testing.T, config Config) *Router {
	r := NewRouterBase(config, []string{"/open"})
	r.Engine().GET("/x", func(c *gin.Context) { c.Status(http.StatusOK) })
	r.Engine().GET("/open", func(c *gin.Context) { c.Status(http.StatusOK) })
	return r
}

func statusOf(r *Router, path string, authorization string) int {
	req := httptest.NewRequest(http.MethodGet, path, nil)
	if authorization != "" {
		req.Header.Set("Authorization", authorization)
	}
	w := httptest.NewRecorder()
	r.Engine().ServeHTTP(w, req)
	return w.Code
}

// countCompares replaces the constant time comparator with one that counts its calls, for the length of the test
func countCompares(t *testing.T) *int {
	calls := 0
	original := constantTimeEquals
	constantTimeEquals = func(x, y []byte) int {
		calls++
		return original(x, y)
	}
	t.Cleanup(func() { constantTimeEquals = original })
	return &calls
}

func TestRawTokenCompare(t *testing.T) {
	const token = "raw-token-0123456789"
	r := testRouter(t, Config{RawAuthTokens: token})
	calls := countCompares(t)

	require.Equal(t, http.StatusOK, statusOf(r, "/x", "Bearer "+token))
	require.Equal(t, 1, *calls, "the raw token is compared through the constant time comparator")

	for _, wrong := range []string{token[:len(token)-1] + "x", "x" + token[1:], token[:len(token)-1], token + "x", "wrong", "Bearer"} {
		require.Equal(t, http.StatusUnauthorized, statusOf(r, "/x", "Bearer "+wrong), wrong)
	}
	require.Equal(t, http.StatusUnauthorized, statusOf(r, "/x", ""))
	require.Equal(t, http.StatusOK, statusOf(r, "/open", ""), "a path without auth stays open")
}

func TestHashedTokenCompare(t *testing.T) {
	const token = "hashed-token-0123456789"
	const secret = "a-token-secret"
	salt := "salt-1"

	for name, tc := range map[string]struct {
		hash    string
		secrets string
	}{
		"hex, default seed":    {HashTokenHex(token, salt, DefaultSeed), ""},
		"hex, given secret":    {HashTokenHex(token, salt, secret), secret},
		"base64, given secret": {HashTokenBase64(token, salt, secret), secret},
	} {
		t.Run(name, func(t *testing.T) {
			r := testRouter(t, Config{AuthTokens: salt + "." + tc.hash, TokenSecrets: tc.secrets})
			calls := countCompares(t)

			require.Equal(t, http.StatusOK, statusOf(r, "/x", "Bearer "+token))
			require.Equal(t, 1, *calls, "the hash is compared through the constant time comparator")

			for _, wrong := range []string{token[:len(token)-1] + "x", token + "x", token[:len(token)-1], "wrong"} {
				require.Equal(t, http.StatusUnauthorized, statusOf(r, "/x", "Bearer "+wrong), wrong)
			}
		})
	}
}

func TestSecureEqual(t *testing.T) {
	require.True(t, SecureEqual("", ""))
	require.True(t, SecureEqual("abc", "abc"))
	require.True(t, SecureEqual("päss", "päss"))
	require.False(t, SecureEqual("abc", "abd"))
	require.False(t, SecureEqual("abc", "abcd"))
	require.False(t, SecureEqual("abcd", "abc"))
	require.False(t, SecureEqual("abc", ""))
	require.False(t, SecureEqual("päss", "pass"))
	calls := countCompares(t)
	SecureEqual("a", "b")
	require.Equal(t, 1, *calls)
}

func TestRawTokensHashedOncePerRequest(t *testing.T) {
	tokens := []string{"raw-token-one-0123", "raw-token-two-0123456789", "raw-token-three"}
	r := testRouter(t, Config{RawAuthTokens: strings.Join(tokens, ",")})

	hashed := 0
	original := digestOf
	digestOf = func(s string) [sha256.Size]byte {
		hashed++
		return original(s)
	}
	t.Cleanup(func() { digestOf = original })

	for _, token := range tokens {
		hashed = 0
		require.Equal(t, http.StatusOK, statusOf(r, "/x", "Bearer "+token))
		require.Equal(t, 1, hashed, "a request hashes the presented token once and none of the configured ones")
	}
	hashed = 0
	require.Equal(t, http.StatusUnauthorized, statusOf(r, "/x", "Bearer wrong"))
	require.Equal(t, 1, hashed, "a rejected request hashes the presented token once")
}
