package appbase

import (
	"strings"
	"testing"
)

// JITSU-302: a configured token without a salt is usually a raw secret put in the variable meant for hashes. The error is
// logged before the process exits, so it must not repeat the token.
func TestCheckAuthTokenFormatDoesNotRepeatTheToken(t *testing.T) {
	err := checkAuthTokenFormat([]string{"salt.hash", "RAW-SECRET-TOKEN-VALUE-123", "another.one"})
	if err == nil {
		t.Fatal("expected an error for a token without a salt")
	}
	if strings.Contains(err.Error(), "RAW-SECRET-TOKEN-VALUE-123") {
		t.Errorf("the error repeats the configured token: %s", err)
	}
	// it still says which one, and what to do
	if !strings.Contains(err.Error(), "#2") || !strings.Contains(err.Error(), "RAW_AUTH_TOKENS") {
		t.Errorf("the error should name the position of the token and the alternative: %s", err)
	}
}

func TestCheckAuthTokenFormatAcceptsSaltedTokens(t *testing.T) {
	if err := checkAuthTokenFormat([]string{"salt.hash", "a.b"}); err != nil {
		t.Errorf("salted tokens are fine, got %v", err)
	}
	if err := checkAuthTokenFormat(nil); err != nil {
		t.Errorf("no tokens is not this function's concern, got %v", err)
	}
}
