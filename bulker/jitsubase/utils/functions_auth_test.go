package utils

import (
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/pem"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"testing"
)

type functionsTestKey struct {
	pem    string
	public ed25519.PublicKey
}

func newFunctionsTestKey(t testing.TB) functionsTestKey {
	t.Helper()
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(private)
	if err != nil {
		t.Fatal(err)
	}
	return functionsTestKey{pem: string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})), public: public}
}

func checkFunctionsSigningKey(key functionsTestKey) error {
	body := []byte(`{"event":"日本語"}`)
	req, err := http.NewRequest("POST", "http://fs-free-1:3456/multi?ids=con1&fullEvents=true", nil)
	if err != nil {
		return err
	}
	if err := SignFunctionsRequest(req, body, "free-1", key.pem); err != nil {
		return err
	}
	digest := sha256.Sum256(body)
	message := strings.Join([]string{"jitsu-functions-v1", "POST", "/multi?ids=con1&fullEvents=true", "free-1", req.Header.Get("X-Jitsu-Request-Timestamp"), hex.EncodeToString(digest[:])}, "\n")
	signature, err := base64.StdEncoding.DecodeString(req.Header.Get("X-Jitsu-Request-Signature"))
	if err != nil {
		return err
	}
	if !ed25519.Verify(key.public, []byte(message), signature) {
		return fmt.Errorf("request was not signed with the supplied key")
	}
	return nil
}

func TestSignFunctionsRequestKeyRotation(t *testing.T) {
	first, second := newFunctionsTestKey(t), newFunctionsTestKey(t)
	for _, key := range []functionsTestKey{first, first, second, second, first} {
		if err := checkFunctionsSigningKey(key); err != nil {
			t.Fatal(err)
		}
	}
	other, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(other)
	if err != nil {
		t.Fatal(err)
	}
	for _, invalid := range []string{
		"", "not-pem",
		string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: []byte("invalid DER")})),
		string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})),
	} {
		for range 2 {
			req, _ := http.NewRequest("POST", "http://fs-free-1:3456/multi", nil)
			if err := SignFunctionsRequest(req, nil, "free-1", invalid); err == nil {
				t.Fatal("invalid key fell back to a cached key")
			}
			if req.Header.Get("X-Jitsu-Request-Signature") != "" {
				t.Fatal("failed signing attached a signature")
			}
		}
		if err := checkFunctionsSigningKey(first); err != nil {
			t.Fatal(err)
		}
	}
}

func TestSignFunctionsRequestConcurrent(t *testing.T) {
	keys := []functionsTestKey{newFunctionsTestKey(t), newFunctionsTestKey(t)}
	var wg sync.WaitGroup
	for worker := range 16 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range 100 {
				if err := checkFunctionsSigningKey(keys[(worker+i)%len(keys)]); err != nil {
					t.Error(err)
					return
				}
			}
		}()
	}
	wg.Wait()
}

func BenchmarkSignFunctionsRequest(b *testing.B) {
	key := newFunctionsTestKey(b)
	body := make([]byte, 1024)
	req, _ := http.NewRequest("POST", "http://fs-free-1:3456/multi?ids=con1&fullEvents=true", nil)
	if err := SignFunctionsRequest(req, body, "free-1", key.pem); err != nil {
		b.Fatal(err)
	}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if err := SignFunctionsRequest(req, body, "free-1", key.pem); err != nil {
			b.Fatal(err)
		}
	}
}

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
