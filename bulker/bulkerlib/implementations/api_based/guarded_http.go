package api_based

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"os"
	"strings"
	"syscall"
	"time"
)

// Outbound HTTP to a URL taken from a customer's destination config (webhook, OTLP endpoint) must not reach the
// cluster's own network. The check runs in the dialer on the address that is actually connected to, so it covers
// DNS answers that change between a check and the connection, IP-literal hosts and every hop of a redirect chain.
//
// It follows the same switches as the function fetch in rotor: FETCH_FORBID_LOCAL turns it on and
// FETCH_LOCAL_WHITELIST lists hostnames that may stay local.

var blockedPrefixes = mustPrefixes(
	"0.0.0.0/8",       // "this" network
	"10.0.0.0/8",      // private
	"100.64.0.0/10",   // carrier-grade NAT (also the range Tailscale uses)
	"127.0.0.0/8",     // loopback
	"169.254.0.0/16",  // link-local, cloud metadata
	"172.16.0.0/12",   // private
	"192.0.0.0/24",    // IETF protocol assignments
	"192.0.2.0/24",    // documentation
	"192.168.0.0/16",  // private
	"198.18.0.0/15",   // benchmarking
	"198.51.100.0/24", // documentation
	"203.0.113.0/24",  // documentation
	"224.0.0.0/4",     // multicast
	"240.0.0.0/4",     // reserved, includes 255.255.255.255
	"2001::/23",       // IETF protocol assignments: Teredo, benchmarking
	"2001:db8::/32",   // documentation
	"2002::/16",       // 6to4: embeds an IPv4 address
	"3fff::/20",       // documentation
)

var globalUnicastV6 = netip.MustParsePrefix("2000::/3")

func mustPrefixes(prefixes ...string) []netip.Prefix {
	result := make([]netip.Prefix, 0, len(prefixes))
	for _, p := range prefixes {
		result = append(result, netip.MustParsePrefix(p))
	}
	return result
}

// isBlockedIP reports whether an address must not be contacted: anything that is not a public unicast address.
func isBlockedIP(addr netip.Addr) bool {
	addr = addr.Unmap()
	if !addr.IsValid() || addr.Zone() != "" {
		return true
	}
	if addr.Is6() && !globalUnicastV6.Contains(addr) {
		return true
	}
	for _, prefix := range blockedPrefixes {
		if prefix.Contains(addr) {
			return true
		}
	}
	return false
}

func forbidLocalFromEnv() (bool, []string) {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("FETCH_FORBID_LOCAL"))) {
	case "1", "true", "yes", "on":
	default:
		return false, nil
	}
	var whitelist []string
	for _, host := range strings.Split(os.Getenv("FETCH_LOCAL_WHITELIST"), ",") {
		if host = strings.ToLower(strings.TrimSpace(host)); host != "" {
			whitelist = append(whitelist, host)
		}
	}
	return true, whitelist
}

// newOutboundHTTPClient returns the client for customer-supplied URLs: guarded when FETCH_FORBID_LOCAL is set.
func newOutboundHTTPClient(timeout time.Duration) *http.Client {
	forbidLocal, whitelist := forbidLocalFromEnv()
	return newHTTPClient(timeout, forbidLocal, whitelist)
}

func newHTTPClient(timeout time.Duration, forbidLocal bool, whitelist []string) *http.Client {
	if !forbidLocal {
		return &http.Client{Timeout: timeout}
	}
	allowed := make(map[string]bool, len(whitelist))
	for _, host := range whitelist {
		allowed[strings.ToLower(host)] = true
	}
	plain := &net.Dialer{Timeout: 30 * time.Second, KeepAlive: 30 * time.Second}
	guarded := &net.Dialer{
		Timeout:   30 * time.Second,
		KeepAlive: 30 * time.Second,
		// Control runs once the hostname is resolved, right before connect, for every address that is tried
		Control: func(_, address string, _ syscall.RawConn) error {
			host, _, err := net.SplitHostPort(address)
			if err != nil {
				return err
			}
			ip, err := netip.ParseAddr(host)
			if err != nil || isBlockedIP(ip) {
				return fmt.Errorf("connection to a non-public address is not allowed")
			}
			return nil
		},
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		host, _, err := net.SplitHostPort(address)
		if err == nil && allowed[strings.ToLower(host)] {
			return plain.DialContext(ctx, network, address)
		}
		return guarded.DialContext(ctx, network, address)
	}
	// A configured proxy would make the proxy the connection target and hide the real destination from the dialer
	transport.Proxy = nil
	return &http.Client{Timeout: timeout, Transport: transport}
}
