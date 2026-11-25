package main

import (
	"strings"
	"testing"
)

// JITSU-302: the error of mergeOAuthCreds is logged (and the process exits), so it must name what is missing without
// printing the source configuration, which holds the user's credentials.
func TestMergeOAuthCredsErrorDoesNotPrintTheConfig(t *testing.T) {
	cfg := map[string]any{
		"apiKey":   "API-KEY-SECRET-VALUE",
		"password": "PASSWORD-SECRET-VALUE",
		"host":     "db.internal.example.com",
		"nested":   map[string]any{"token": "NESTED-TOKEN-SECRET-VALUE"},
	}
	_, err := mergeOAuthCreds("airbyte/source-github", cfg, nil, nil)
	if err == nil {
		t.Fatal("expected an error: the config has no credentials section")
	}
	msg := err.Error()
	for _, secret := range []string{"API-KEY-SECRET-VALUE", "PASSWORD-SECRET-VALUE", "db.internal.example.com", "NESTED-TOKEN-SECRET-VALUE"} {
		if strings.Contains(msg, secret) {
			t.Errorf("the error prints a configuration value %q: %s", secret, msg)
		}
	}
	// it stays useful: it says which keys the config does have
	for _, key := range []string{"apiKey", "host", "nested", "password"} {
		if !strings.Contains(msg, key) {
			t.Errorf("the error should name the key %q: %s", key, msg)
		}
	}
	if !strings.Contains(msg, "no credentials found") {
		t.Errorf("the error should still say what is wrong: %s", msg)
	}
}

func TestMergeOAuthCredsErrorWithAnEmptyConfig(t *testing.T) {
	_, err := mergeOAuthCreds("airbyte/source-github", map[string]any{}, nil, nil)
	if err == nil || !strings.Contains(err.Error(), "no credentials found") {
		t.Fatalf("expected the 'no credentials found' error, got %v", err)
	}
}
