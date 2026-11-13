package api_based

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	bulker "github.com/jitsucom/bulker/bulkerlib"
	"github.com/stretchr/testify/require"
)

func newWebhookFor(t *testing.T, url string) *WebhookBulker {
	b, err := NewWebhookBulker(bulker.Config{DestinationConfig: map[string]any{"url": url}})
	require.NoError(t, err)
	return b.(*WebhookBulker)
}

func TestIngestEndpointNeedsAnExactMatch(t *testing.T) {
	t.Setenv("FETCH_FORBID_LOCAL", "true")
	oldGlobal, oldLocal := GlobalIngestEndpoint, LocalIngestEndpoint
	GlobalIngestEndpoint, LocalIngestEndpoint = "https://ingest.example.com/api/s/s2s/batch", ""
	defer func() { GlobalIngestEndpoint, LocalIngestEndpoint = oldGlobal, oldLocal }()

	var hits atomic.Int32
	internal := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits.Add(1) }))
	defer internal.Close() // listens on 127.0.0.1

	// the endpoint as a fragment or query of a local URL, and with something in front of it
	for _, crafted := range []string{
		internal.URL + "/admin#" + GlobalIngestEndpoint,
		internal.URL + "/admin?x=" + GlobalIngestEndpoint,
		"http://evil.example/" + GlobalIngestEndpoint,
	} {
		w := newWebhookFor(t, crafted)
		require.Falsef(t, w.isIngest, "%s must not be treated as the ingest endpoint", crafted)
		_, err := w.httpClient.Get(internal.URL)
		require.Errorf(t, err, "%s must use the guarded client", crafted)
		require.Contains(t, err.Error(), "non-public address")
	}
	require.EqualValues(t, 0, hits.Load())

	// the configured endpoint itself, with or without a trailing slash, is the ingest endpoint
	require.True(t, newWebhookFor(t, GlobalIngestEndpoint).isIngest)
	require.True(t, newWebhookFor(t, GlobalIngestEndpoint+"/").isIngest)
}

func TestIngestEndpointIsReplacedByTheLocalOne(t *testing.T) {
	oldGlobal, oldLocal := GlobalIngestEndpoint, LocalIngestEndpoint
	GlobalIngestEndpoint, LocalIngestEndpoint = "https://ingest.example.com/api/s/s2s/batch", "http://ingest.internal:3049/api/s/s2s/batch"
	defer func() { GlobalIngestEndpoint, LocalIngestEndpoint = oldGlobal, oldLocal }()

	w := newWebhookFor(t, GlobalIngestEndpoint)
	require.True(t, w.isIngest)
	require.Equal(t, LocalIngestEndpoint, w.url)
	require.Equal(t, GlobalIngestEndpoint, w.originalUrl)
	require.False(t, newWebhookFor(t, "http://127.0.0.1:1/#"+GlobalIngestEndpoint).isIngest)
}
