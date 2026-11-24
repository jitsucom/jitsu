package main

import (
	"testing"

	"github.com/jitsucom/bulker/jitsubase/appbase"
	"github.com/stretchr/testify/require"
)

// checkHash decides whether the secret of a write key matches the stored `${salt}.${hash}`. The hash is compared in
// constant time (appbase.SecureEqual), so a caller cannot find the hash out byte by byte from the time it takes.
func TestCheckHash(t *testing.T) {
	r := &Router{
		Router: &appbase.Router{Service: appbase.NewServiceBase("test")},
		config: &Config{GlobalHashSecrets: []string{"global-secret-1", "global-secret-2"}},
	}
	stored := func(secret, salt, global string) string { return salt + "." + hashApiKey(secret, salt, global) }

	// the right secret, hashed with any of the global secrets
	require.True(t, r.checkHash(stored("key-secret", "salt", "global-secret-1"), "key-secret"))
	require.True(t, r.checkHash(stored("key-secret", "salt", "global-secret-2"), "key-secret"))

	// wrong: another secret (same length, shorter, longer, empty), another salt, a global secret that is not configured
	hash := stored("key-secret", "salt", "global-secret-1")
	for _, wrong := range []string{"key-secreT", "key-secre", "key-secret1", "", "other"} {
		require.False(t, r.checkHash(hash, wrong), wrong)
	}
	require.False(t, r.checkHash("other-salt."+hashApiKey("key-secret", "salt", "global-secret-1"), "key-secret"))
	require.False(t, r.checkHash(stored("key-secret", "salt", "not-configured"), "key-secret"))

	// not in the format `${salt}.${hash}`
	require.False(t, r.checkHash("nodothere", "key-secret"))
	require.False(t, r.checkHash("", "key-secret"))
}
