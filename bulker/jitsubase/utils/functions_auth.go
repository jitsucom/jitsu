package utils

import (
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/pem"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

type functionsSigningKeyEntry struct {
	pem string
	key ed25519.PrivateKey
}

var functionsSigningKeyCache atomic.Pointer[functionsSigningKeyEntry]

func parsedFunctionsSigningKey(privateKeyPEM string) (ed25519.PrivateKey, error) {
	if cached := functionsSigningKeyCache.Load(); cached != nil && cached.pem == privateKeyPEM {
		return cached.key, nil
	}
	block, _ := pem.Decode([]byte(privateKeyPEM))
	if block == nil {
		return nil, fmt.Errorf("invalid functions signing key PEM")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("invalid functions signing key")
	}
	key, ok := parsed.(ed25519.PrivateKey)
	if !ok {
		return nil, fmt.Errorf("functions signing key must be Ed25519")
	}
	// One immutable entry: rotations replace it without locking concurrent signers.
	// Always return this request's key, even if another request replaces the cache.
	functionsSigningKeyCache.Store(&functionsSigningKeyEntry{pem: privateKeyPEM, key: key})
	return key, nil
}

// SignFunctionsRequest binds the method, path, deployment and exact wire body.
// The matching runtime receives only the public verification key.
func SignFunctionsRequest(req *http.Request, body []byte, deploymentID, privateKeyPEM string) error {
	if deploymentID == "" || privateKeyPEM == "" {
		return fmt.Errorf("functions request signing is not configured")
	}
	key, err := parsedFunctionsSigningKey(privateKeyPEM)
	if err != nil {
		return err
	}
	stamp := strconv.FormatInt(time.Now().UnixMilli(), 10)
	digest := sha256.Sum256(body)
	message := strings.Join([]string{"jitsu-functions-v1", strings.ToUpper(req.Method), req.URL.RequestURI(), deploymentID, stamp, hex.EncodeToString(digest[:])}, "\n")
	req.Header.Set("X-Jitsu-Request-Timestamp", stamp)
	req.Header.Set("X-Jitsu-Request-Signature", base64.StdEncoding.EncodeToString(ed25519.Sign(key, []byte(message))))
	return nil
}
