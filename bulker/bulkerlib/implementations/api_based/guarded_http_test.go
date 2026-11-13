package api_based

import (
	"net"
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
	// One address per range in blockedPrefixes, so a range cannot be dropped from the table unnoticed. The same ranges
	// are in libs/core-functions-lib/src/functions/lib/public-address.ts (rotor's guard): keep the two in step.
	blocked := []string{
		"127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1",
		"0.0.0.0", "224.0.0.1", "255.255.255.255", "::1", "::", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:169.254.169.254",
		"2002:7f00:1::1",
		"192.0.0.1", "192.0.2.1", "198.18.0.1", "198.19.255.255", "198.51.100.1", "203.0.113.1",
		"192.31.196.1", "192.52.193.1", "192.88.99.1", "192.175.48.1",
		"2001::1", "2001:db8::1", "3fff::1", "2620:4f:8000::1", "2620:4f:8000:ffff::1",
		"100::1", "64:ff9b::a00:1", "ff02::1",
		"fe80::1%eth0", // a zone id is refused outright
	}
	for _, a := range blocked {
		require.Truef(t, isBlockedIP(netip.MustParseAddr(a)), "%s must be blocked", a)
	}
	require.True(t, isBlockedIP(netip.Addr{}), "an invalid address is refused")
	public := []string{
		"8.8.8.8", "93.184.216.34", "172.32.0.1", "100.128.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8",
		// just outside the narrow anycast ranges
		"192.31.197.1", "192.52.194.1", "192.88.100.1", "192.175.49.1", "2620:4f:8001::1",
	}
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

// The same table is in libs/core-functions-lib/__tests__/guarded-fetch.test.ts: one value set for every service has to
// turn the guard on in Bulker and in rotor alike.
func TestForbidLocalSpellingsMatchRotor(t *testing.T) {
	for _, value := range []string{"true", "TRUE", " True ", "1", "yes", "on", "ON"} {
		t.Setenv("FETCH_FORBID_LOCAL", value)
		on, _ := forbidLocalFromEnv()
		require.Truef(t, on, "%q turns the guard on", value)
	}
	for _, value := range []string{"false", "0", "no", "off", "", "   ", "enabled"} {
		t.Setenv("FETCH_FORBID_LOCAL", value)
		on, _ := forbidLocalFromEnv()
		require.Falsef(t, on, "%q leaves the guard off", value)
	}
}

// FETCH_LOCAL_WHITELIST accepts an IPv6 address with or without brackets, as the function fetch in rotor does.
func TestGuardedClientAllowsWhitelistedIPv6InEitherSpelling(t *testing.T) {
	listener, err := net.Listen("tcp", "[::1]:0")
	if err != nil {
		t.Skipf("no IPv6 loopback on this machine: %v", err)
	}
	srv := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	srv.Listener = listener
	srv.Start()
	defer srv.Close()

	for _, entry := range []string{"[::1]", "::1", " [::1] "} {
		res, err := newHTTPClient(5*time.Second, true, []string{entry}).Get(srv.URL)
		require.NoErrorf(t, err, "whitelist entry %q must allow %s", entry, srv.URL)
		res.Body.Close()
	}

	// an entry for another address does not open it
	_, err = newHTTPClient(5*time.Second, true, []string{"[::2]"}).Get(srv.URL)
	require.Error(t, err)
	require.Contains(t, err.Error(), "non-public address")
}

// The whole webhook path, not only the client: the destination reads FETCH_FORBID_LOCAL and FETCH_LOCAL_WHITELIST from
// the environment when it is created and delivers to an IPv6 address that is whitelisted in either spelling.
func TestWebhookDeliversToAWhitelistedIPv6Destination(t *testing.T) {
	listener, err := net.Listen("tcp", "[::1]:0")
	if err != nil {
		t.Skipf("no IPv6 loopback on this machine: %v", err)
	}
	var hits atomic.Int32
	srv := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		_, _ = w.Write([]byte("ok"))
	}))
	srv.Listener = listener
	srv.Start()
	defer srv.Close()
	withIngestEndpoints(t, "", "")

	deliver := func(whitelist string) (int, string, error) {
		t.Setenv("FETCH_FORBID_LOCAL", "true")
		t.Setenv("FETCH_LOCAL_WHITELIST", whitelist)
		return newWebhookFor(t, srv.URL).Upload(strings.NewReader(`[{"a":1}]`), "events", 1, nil)
	}

	for _, whitelist := range []string{"[::1]", "::1", "internal.example, [::1]"} {
		before := hits.Load()
		status, body, err := deliver(whitelist)
		require.NoErrorf(t, err, "whitelist %q must let the webhook reach %s", whitelist, srv.URL)
		require.Equal(t, 200, status)
		require.Equal(t, "ok", body)
		require.Equal(t, before+1, hits.Load())
	}

	// no entry, or an entry for another address: the guard refuses and the server is never reached
	before := hits.Load()
	for _, whitelist := range []string{"", "[::2]", "localhost"} {
		_, _, err := deliver(whitelist)
		require.Errorf(t, err, "whitelist %q must not open %s", whitelist, srv.URL)
		require.Contains(t, err.Error(), "non-public address")
	}
	require.Equal(t, before, hits.Load())

	// OTLP destinations build their client the same way
	t.Setenv("FETCH_FORBID_LOCAL", "true")
	t.Setenv("FETCH_LOCAL_WHITELIST", "[::1]")
	res, err := newOutboundHTTPClient(5 * time.Second).Get(srv.URL)
	require.NoError(t, err)
	res.Body.Close()
}
