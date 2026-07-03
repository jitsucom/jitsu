package main

import (
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/jitsucom/bulker/jitsubase/types"
	"github.com/stretchr/testify/require"
)

func ginContextWithHeaders(headers map[string]string) *gin.Context {
	req := httptest.NewRequest("POST", "https://data.example.com/api/s/s2s/track", nil)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = req
	return c
}

func TestBuildContextHeaders(t *testing.T) {
	c := ginContextWithHeaders(map[string]string{
		"User-Agent":      "Mozilla/5.0",
		"Accept":          "application/json",
		"Sec-Ch-Ua":       `"Chromium";v="124"`,
		"Cookie":          "session=secret",
		"Authorization":   "Bearer secret-token",
		"X-Api-Key":       "secret-key",
		"X-Write-Key":     "keyId:keySecret",
		"X-Jitsu-Version": "1.0",
		"X-Vercel-Id":     "abc",
		"__sql_type_foo":  "varchar(4)",
	})

	headers := buildContextHeaders(c, nil, nil)

	// allow-listed values are kept as-is
	require.Equal(t, "Mozilla/5.0", headers["user-agent"])
	require.Equal(t, "application/json", headers["accept"])
	require.Equal(t, `"Chromium";v="124"`, headers["sec-ch-ua"])
	// host is promoted by net/http into Request.Host
	require.Equal(t, "data.example.com", headers["host"])
	// non-allow-listed headers keep the name but the value is masked
	require.Equal(t, maskedHeaderValue, headers["cookie"])
	require.Equal(t, maskedHeaderValue, headers["authorization"])
	require.Equal(t, maskedHeaderValue, headers["x-api-key"])
	// write key gets the dedicated partial mask
	require.Equal(t, "keyId:***", headers["x-write-key"])
	// internal and __sql_type* headers are dropped entirely
	require.NotContains(t, headers, "x-jitsu-version")
	require.NotContains(t, headers, "x-vercel-id")
	require.NotContains(t, headers, "__sql_type_foo")
}

func TestBuildContextHeadersBodyOverlay(t *testing.T) {
	c := ginContextWithHeaders(map[string]string{
		"User-Agent": "server-sdk/1.0",
	})

	headers := buildContextHeaders(c, map[string]any{
		"User-Agent":     "Mozilla/5.0 (device)", // allow-listed: overrides the request header
		"X-Api-Key":      "leaked",               // not allow-listed: ignored
		"__sql_type_bar": "jsonb",                // not allow-listed: ignored
		"sec-fetch-mode": "navigate",             // allow-listed: added
		"accept":         map[string]any{"a": 1}, // non-string values are ignored
	}, nil)

	require.Equal(t, "Mozilla/5.0 (device)", headers["user-agent"])
	require.Equal(t, "navigate", headers["sec-fetch-mode"])
	require.NotContains(t, headers, "x-api-key")
	require.NotContains(t, headers, "__sql_type_bar")
	require.NotContains(t, headers, "accept")
}

func TestBuildContextHeadersRedundantWithContext(t *testing.T) {
	c := ginContextWithHeaders(map[string]string{
		"User-Agent": "Mozilla/5.0",
		"Referer":    "https://example.com/page",
		"Accept":     "*/*",
	})
	eventContext := types.JsonFromMap(map[string]any{
		"userAgent": "Mozilla/5.0",
		"page": map[string]any{
			"url":      "https://example.com/other",
			"referrer": "https://example.com/page",
			"host":     "data.example.com",
		},
	})

	headers := buildContextHeaders(c, nil, eventContext)

	require.NotContains(t, headers, "user-agent") // duplicates context.userAgent
	require.NotContains(t, headers, "referer")    // duplicates context.page.referrer
	require.NotContains(t, headers, "host")       // duplicates context.page.host
	require.Equal(t, "*/*", headers["accept"])    // unrelated headers stay

	// differing values are kept - the mismatch is a bot signal; referer matching only
	// page.url (not page.referrer) is kept too
	eventContext2 := types.JsonFromMap(map[string]any{
		"userAgent": "Mozilla/5.0 (different)",
		"page": map[string]any{
			"url":      "https://example.com/page",
			"referrer": "https://google.com/",
			"host":     "example.com",
		},
	})
	headers2 := buildContextHeaders(c, nil, eventContext2)
	require.Equal(t, "Mozilla/5.0", headers2["user-agent"])
	require.Equal(t, "https://example.com/page", headers2["referer"])
	require.Equal(t, "data.example.com", headers2["host"])
}
