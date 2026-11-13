package api_based

import (
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// roundTripFunc lets a test stand in for the network.
type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func countingClient(calls *atomic.Int32, err error) *http.Client {
	return &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		calls.Add(1)
		return nil, err
	})}
}

func TestRefuseNonPublicAddress(t *testing.T) {
	// the dialer's hook must let a public address through (it is the outage case if it refuses everything)
	require.NoError(t, refuseNonPublicAddress("tcp", "8.8.8.8:443", nil))
	require.NoError(t, refuseNonPublicAddress("tcp", "[2001:4860:4860::8888]:443", nil))
	for _, blocked := range []string{"127.0.0.1:80", "[::1]:80", "10.0.0.1:80", "169.254.169.254:80", "100.64.0.1:80"} {
		require.ErrorIs(t, refuseNonPublicAddress("tcp", blocked, nil), ErrBlockedAddress, blocked)
	}
	require.Error(t, refuseNonPublicAddress("tcp", "not-an-address", nil))
	require.ErrorIs(t, refuseNonPublicAddress("tcp", "example.com:80", nil), ErrBlockedAddress)
}

func TestRefusalIsTypedAndDoesNotShowTheResolvedAddress(t *testing.T) {
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits.Add(1) }))
	defer srv.Close()
	// a name, so that what it resolved to (127.0.0.1 or ::1) is the thing that must not travel back to the customer
	_, err := newHTTPClient(5*time.Second, true, nil).Get(strings.Replace(srv.URL, "127.0.0.1", "localhost", 1))
	require.Error(t, err)
	require.ErrorIs(t, err, ErrBlockedAddress)
	require.NotContains(t, err.Error(), "dial tcp")
	require.NotContains(t, err.Error(), "127.0.0.1")
	require.NotContains(t, err.Error(), "[::1]")
	require.Equal(t, int32(0), hits.Load())
}

func TestGuardedClientIgnoresProxyEnvironment(t *testing.T) {
	t.Setenv("HTTP_PROXY", "http://proxy.invalid:3128")
	t.Setenv("HTTPS_PROXY", "http://proxy.invalid:3128")
	transport, ok := newHTTPClient(time.Second, true, nil).Transport.(addressRefusalTransport)
	require.True(t, ok)
	require.Nil(t, transport.next.Proxy, "a proxy would become the connection target and hide the real destination")
}

func TestWebhookDoesNotRetryARefusedAddress(t *testing.T) {
	// an ingest-looking destination keeps retries for transient errors, but not for a refusal
	withIngestEndpoints(t, prodIngestPattern, "")
	t.Setenv("FETCH_FORBID_LOCAL", "true")
	w := newWebhookFor(t, "https://stream.d.jitsu.com/batch")
	require.True(t, w.isIngest)

	var refusedCalls atomic.Int32
	w.httpClient = countingClient(&refusedCalls, ErrBlockedAddress)
	_, _, err := w.Upload(strings.NewReader(`[{"a":1}]`), "events", 1, nil)
	require.Error(t, err)
	require.Contains(t, err.Error(), "non-public address")
	require.Equal(t, int32(1), refusedCalls.Load())

	var transientCalls atomic.Int32
	w.httpClient = countingClient(&transientCalls, errors.New("connection reset"))
	_, _, err = w.Upload(strings.NewReader(`[{"a":1}]`), "events", 1, nil)
	require.Error(t, err)
	require.Equal(t, int32(len(retryDelaysMs)), transientCalls.Load())
}

func TestOtlpDoesNotRetryARefusedAddress(t *testing.T) {
	o := newTestOtlpBulker(t, "http://otlp.example/v1/logs")
	var calls atomic.Int32
	o.httpClient = countingClient(&calls, ErrBlockedAddress)
	status, body, err := o.Upload(strings.NewReader(otlpEnvelopeLine()), "live_events", 1, nil)
	require.ErrorIs(t, err, ErrBlockedAddress)
	require.Equal(t, 0, status)
	require.Equal(t, "", body)
	require.Equal(t, int32(1), calls.Load())
}

// The OTLP destination builds its own client; this goes through NewOtlpBulker, not through the factory alone.
func TestOtlpDestinationIsGuardedWhenTheFlagIsOn(t *testing.T) {
	t.Setenv("FETCH_FORBID_LOCAL", "true")
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits.Add(1) }))
	defer srv.Close()
	o := newTestOtlpBulker(t, srv.URL)
	_, _, err := o.Upload(strings.NewReader(otlpEnvelopeLine()), "live_events", 1, nil)
	require.ErrorIs(t, err, ErrBlockedAddress)
	require.Equal(t, int32(0), hits.Load())
}

// A response over the cap is read only up to the cap, but the rest is drained so that the connection is reused.
func TestWebhookReusesTheConnectionAfterACappedResponse(t *testing.T) {
	withIngestEndpoints(t, "", "")
	var connections atomic.Int32
	srv := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(strings.Repeat("x", maxResponseBodyBytes+40*1024)))
	}))
	srv.Config.ConnState = func(_ net.Conn, state http.ConnState) {
		if state == http.StateNew {
			connections.Add(1)
		}
	}
	srv.Start()
	defer srv.Close()

	w := newWebhookFor(t, srv.URL)
	for i := 0; i < 3; i++ {
		status, body, err := w.Upload(strings.NewReader(`[{"a":1}]`), "events", 1, nil)
		require.NoError(t, err)
		require.Equal(t, 200, status)
		require.Equal(t, maxResponseBodyBytes, len(body), "what is kept is still capped")
	}
	require.Equal(t, int32(1), connections.Load(), "three deliveries over one connection")
}
