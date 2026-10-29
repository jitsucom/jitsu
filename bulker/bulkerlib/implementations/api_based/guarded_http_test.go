package api_based

import (
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestIsBlockedIP(t *testing.T) {
	blocked := []string{
		"127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1",
		"0.0.0.0", "224.0.0.1", "255.255.255.255", "::1", "::", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:169.254.169.254",
		"2002:7f00:1::1",
	}
	for _, a := range blocked {
		require.Truef(t, isBlockedIP(netip.MustParseAddr(a)), "%s must be blocked", a)
	}
	public := []string{"8.8.8.8", "93.184.216.34", "172.32.0.1", "100.128.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"}
	for _, a := range public {
		require.Falsef(t, isBlockedIP(netip.MustParseAddr(a)), "%s must be allowed", a)
	}
}

func TestOutboundClientGuardOffByDefault(t *testing.T) {
	t.Setenv("FETCH_FORBID_LOCAL", "")
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits.Add(1) }))
	defer srv.Close()
	res, err := newOutboundHTTPClient(5 * time.Second).Get(srv.URL)
	require.NoError(t, err)
	res.Body.Close()
	require.EqualValues(t, 1, hits.Load())
}

func TestGuardedClientBlocksLocalAddress(t *testing.T) {
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits.Add(1) }))
	defer srv.Close() // listens on 127.0.0.1

	_, err := newHTTPClient(5*time.Second, true, nil).Get(srv.URL)
	require.Error(t, err)
	require.Contains(t, err.Error(), "non-public address")
	require.EqualValues(t, 0, hits.Load())
}

func TestGuardedClientBlocksRedirectToLocalAddress(t *testing.T) {
	var internalHits atomic.Int32
	internal := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { internalHits.Add(1) }))
	defer internal.Close()
	redirector := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, internal.URL+"/metadata", http.StatusFound)
	}))
	defer redirector.Close()

	// "localhost" is the one allowed local host, so the first hop connects and the redirect target is refused
	client := newHTTPClient(5*time.Second, true, []string{"localhost"})
	port := redirector.URL[strings.LastIndex(redirector.URL, ":")+1:]
	_, err := client.Get("http://localhost:" + port + "/")
	require.Error(t, err)
	require.Contains(t, err.Error(), "non-public address")
	require.EqualValues(t, 0, internalHits.Load())
}

func TestGuardedClientAllowsWhitelistedHost(t *testing.T) {
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits.Add(1) }))
	defer srv.Close()
	port := srv.URL[strings.LastIndex(srv.URL, ":")+1:]

	res, err := newHTTPClient(5*time.Second, true, []string{"LocalHost"}).Get("http://localhost:" + port + "/")
	require.NoError(t, err)
	res.Body.Close()
	require.EqualValues(t, 1, hits.Load())
}

func TestForbidLocalFromEnv(t *testing.T) {
	t.Setenv("FETCH_FORBID_LOCAL", "TRUE")
	t.Setenv("FETCH_LOCAL_WHITELIST", " Internal.Example , ,other.example")
	on, whitelist := forbidLocalFromEnv()
	require.True(t, on)
	require.Equal(t, []string{"internal.example", "other.example"}, whitelist)

	t.Setenv("FETCH_FORBID_LOCAL", "no")
	on, _ = forbidLocalFromEnv()
	require.False(t, on)
}
