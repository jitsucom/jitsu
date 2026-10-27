package utils

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/pem"
	"net/http"
	"strings"
	"testing"
)

func TestSignFunctionsRequest(t *testing.T) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(priv)
	if err != nil {
		t.Fatal(err)
	}
	key := string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))
	body := []byte(`{"workspaceId":"tenant-1","event":"日本語"}`)
	req, _ := http.NewRequest("POST", "http://fs-free-1:3456/multi?ids=con1&fullEvents=true", nil)
	if err := SignFunctionsRequest(req, body, "free-1", key); err != nil {
		t.Fatal(err)
	}
	sig, err := base64.StdEncoding.DecodeString(req.Header.Get("X-Jitsu-Request-Signature"))
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(body)
	message := strings.Join([]string{"jitsu-functions-v1", "POST", "/multi?ids=con1&fullEvents=true", "free-1", req.Header.Get("X-Jitsu-Request-Timestamp"), hex.EncodeToString(digest[:])}, "\n")
	if !ed25519.Verify(pub, []byte(message), sig) {
		t.Fatal("signature does not bind the canonical request")
	}
	if ed25519.Verify(pub, []byte(strings.Replace(message, "free-1", "other-deployment", 1)), sig) {
		t.Fatal("signature authorizes another deployment")
	}
	for _, badKey := range []string{"", "not-pem"} {
		if SignFunctionsRequest(req, body, "free-1", badKey) == nil {
			t.Fatal("missing/malformed key was accepted")
		}
	}
	if SignFunctionsRequest(req, body, "", key) == nil {
		t.Fatal("missing deployment was accepted")
	}
}
