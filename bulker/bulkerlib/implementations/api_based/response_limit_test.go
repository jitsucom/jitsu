package api_based

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	bulker "github.com/jitsucom/bulker/bulkerlib"
	"github.com/stretchr/testify/require"
)

func TestShortResponse(t *testing.T) {
	require.Equal(t, "ok", shortResponse("ok"))
	require.Equal(t, strings.Repeat("a", maxStoredResponseBytes), shortResponse(strings.Repeat("a", maxStoredResponseBytes)))

	long := shortResponse(strings.Repeat("secret-from-an-internal-host ", 100))
	require.True(t, strings.HasSuffix(long, "...(truncated)"))
	require.LessOrEqual(t, len(long), maxStoredResponseBytes+len("...(truncated)"))

	// never cuts in the middle of a multi-byte character
	multi := shortResponse(strings.Repeat("é", 1000))
	require.True(t, strings.HasSuffix(multi, "...(truncated)"))
	require.NotContains(t, multi, "�")
}

func TestWebhookReadsOnlyASmallResponse(t *testing.T) {
	t.Setenv("FETCH_FORBID_LOCAL", "")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(strings.Repeat("x", 5*1024*1024)))
	}))
	defer srv.Close()

	b, err := NewWebhookBulker(bulker.Config{DestinationConfig: map[string]any{"url": srv.URL, "method": "POST"}})
	require.NoError(t, err)
	status, resp, err := b.(*WebhookBulker).Upload(strings.NewReader(`[{"a":1}]`), "events", 1, nil)
	require.Error(t, err)
	require.Equal(t, 500, status)
	require.LessOrEqual(t, len(resp), maxResponseBodyBytes)
	require.Equal(t, maxResponseBodyBytes, len(resp))
}
