package api_based

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/require"
)

// Production sets GLOBAL_INGEST_ENDPOINT to a host-suffix pattern (".d.jitsu.com/batch"), not a complete URL.
const prodIngestPattern = ".d.jitsu.com/batch"

func withIngestEndpoints(t *testing.T, global, local string) {
	oldGlobal, oldLocal := GlobalIngestEndpoint, LocalIngestEndpoint
	GlobalIngestEndpoint, LocalIngestEndpoint = global, local
	t.Cleanup(func() { GlobalIngestEndpoint, LocalIngestEndpoint = oldGlobal, oldLocal })
}

func TestIngestSuffixPatternKeepsInternalRoutingAndRetries(t *testing.T) {
	t.Setenv("FETCH_FORBID_LOCAL", "true")
	var hits atomic.Int32
	internal := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits.Add(1) }))
	defer internal.Close() // our own ingest service, reached on a loopback address
	withIngestEndpoints(t, prodIngestPattern, internal.URL+"/api/s/s2s/batch")

	for _, legit := range []string{
		"https://stream.d.jitsu.com/batch",
		"https://stream.d.jitsu.com/batch/",
		"http://stream.d.jitsu.com/batch",
		"https://a.b.d.jitsu.com/batch",
		"https://Stream.D.Jitsu.com/batch",
	} {
		w := newWebhookFor(t, legit)
		require.Truef(t, w.isIngest, "%s is an ingest destination: it keeps the ingest retries", legit)
		require.Equalf(t, LocalIngestEndpoint, w.url, "%s is rewritten to the internal ingest service", legit)
		require.Equal(t, legit, w.originalUrl)
		// the rewrite makes the target our own service, so the plain client is the right one
		resp, err := w.httpClient.Get(internal.URL)
		require.NoErrorf(t, err, "%s: the internal rewrite is not blocked by the guard", legit)
		resp.Body.Close()
	}
}

func TestIngestSuffixPatternRejectsLookalikes(t *testing.T) {
	t.Setenv("FETCH_FORBID_LOCAL", "true")
	var hits atomic.Int32
	internal := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits.Add(1) }))
	defer internal.Close()
	withIngestEndpoints(t, prodIngestPattern, "http://ingest.internal:3049/api/s/s2s/batch")

	for _, crafted := range []string{
		internal.URL + "/admin#" + prodIngestPattern,                      // the pattern as a fragment of a local URL
		internal.URL + "/admin?x=" + prodIngestPattern,                    // ... as a query
		"http://127.0.0.1:1/x" + prodIngestPattern,                        // ... as the end of a path
		"https://stream.d.jitsu.com/batch#x",                              // fragment
		"https://stream.d.jitsu.com/batch?x=1",                            // query
		"https://user:pass@stream.d.jitsu.com/batch",                      // userinfo
		"https://stream.d.jitsu.com:8443/batch",                           // explicit port
		"https://stream.d.jitsu.com/batch/extra",                          // longer path
		"https://stream.d.jitsu.com/other",                                // other path
		"https://d.jitsu.com/batch",                                       // the bare domain: no subdomain label
		"https://evil-d.jitsu.com/batch",                                  // lookalike: not a label boundary
		"https://stream.d.jitsu.com.evil.example/batch",                   // pattern host is only a prefix
		"https://stream.d.jitsu.com@127.0.0.1:" + "1/batch",               // userinfo trick towards loopback
		"ftp://stream.d.jitsu.com/batch",                                  // not http(s)
		"https://.d.jitsu.com/batch",                                      // empty label
		"https:///batch",                                                  // no host
		"https://stream.d.jitsu.com//batch",                               // doubled slash
		"https://stream.d.jitsu.com/%62atch",                              // encoded path
		"https://stream.d.jitsu.com\\@127.0.0.1/batch",                    // backslash userinfo trick
		"https://stream.d.jitsu.com%2e@127.0.0.1/batch",                   // encoded dot before userinfo
		"https:stream.d.jitsu.com/batch",                                  // opaque form
		"https://127.0.0.1/batch",                                         // IP literal
		"https://stream.d.jitsu.com.:443/batch" + "#" + prodIngestPattern, // trailing dot, port and fragment
	} {
		w := newWebhookFor(t, crafted)
		require.Falsef(t, w.isIngest, "%s must not be treated as an ingest destination", crafted)
		require.Equal(t, crafted, w.url, "%s must not be rewritten", crafted)
		_, err := w.httpClient.Get(internal.URL)
		require.Errorf(t, err, "%s must use the guarded client", crafted)
		require.Contains(t, err.Error(), "non-public address")
	}
	require.EqualValues(t, 0, hits.Load())
}

// Without LOCAL_INGEST_ENDPOINT nothing is rewritten, so the request goes to the destination's own address:
// the destination keeps the ingest retries but the outbound guard stays on.
func TestIngestSuffixPatternWithoutLocalEndpointKeepsTheGuard(t *testing.T) {
	t.Setenv("FETCH_FORBID_LOCAL", "true")
	var hits atomic.Int32
	internal := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits.Add(1) }))
	defer internal.Close()
	withIngestEndpoints(t, prodIngestPattern, "")

	w := newWebhookFor(t, "https://stream.d.jitsu.com/batch")
	require.True(t, w.isIngest, "retries apply to an ingest destination")
	require.Equal(t, "https://stream.d.jitsu.com/batch", w.url, "nothing to rewrite to")
	_, err := w.httpClient.Get(internal.URL)
	require.Error(t, err, "no rewrite, so the guard stays on")
	require.Contains(t, err.Error(), "non-public address")
	require.EqualValues(t, 0, hits.Load())
}

// The complete-URL form of the setting (used by the earlier tests and by self-hosted setups) keeps working too.
func TestIngestCompleteURLFormStillWorks(t *testing.T) {
	withIngestEndpoints(t, "https://ingest.example.com/api/s/s2s/batch", "http://ingest.internal:3049/api/s/s2s/batch")
	require.True(t, newWebhookFor(t, "https://ingest.example.com/api/s/s2s/batch").isIngest)
	require.True(t, newWebhookFor(t, "https://ingest.example.com/api/s/s2s/batch/").isIngest)
	require.False(t, newWebhookFor(t, "https://ingest.example.com/api/s/s2s/batch?x=1").isIngest)
	require.False(t, newWebhookFor(t, "https://other.example.com/api/s/s2s/batch").isIngest)
}
