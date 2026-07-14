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

func TestPatchEventHeadersGating(t *testing.T) {
	// capture disabled (the default): browser events must not carry context.headers,
	// even if the body smuggled one in.
	c := ginContextWithHeaders(map[string]string{"User-Agent": "Mozilla/5.0", "Sec-Fetch-Mode": "cors"})
	ev := types.JsonFromMap(map[string]any{
		"event": "test",
		"context": map[string]any{"headers": map[string]any{"user-agent": "spoofed"}},
	})
	require.NoError(t, patchEvent(c, "msg1", ev, "track", IngestTypeBrowser, nil, "", &StreamWithDestinations{}))
	ctx, _ := ev.GetN("context").(types.Json)
	require.NotNil(t, ctx)
	require.Nil(t, ctx.GetN("headers"))

	// nil stream behaves like disabled and does not panic
	c = ginContextWithHeaders(map[string]string{"User-Agent": "Mozilla/5.0"})
	ev = types.JsonFromMap(map[string]any{"event": "test"})
	require.NoError(t, patchEvent(c, "msg2", ev, "track", IngestTypeBrowser, nil, "", nil))
	ctx, _ = ev.GetN("context").(types.Json)
	require.NotNil(t, ctx)
	require.Nil(t, ctx.GetN("headers"))

	// capture enabled: browser events get context.headers derived from the request
	c = ginContextWithHeaders(map[string]string{"User-Agent": "Mozilla/5.0", "Sec-Fetch-Mode": "cors"})
	ev = types.JsonFromMap(map[string]any{"event": "test"})
	require.NoError(t, patchEvent(c, "msg3", ev, "track", IngestTypeBrowser, nil, "", &StreamWithDestinations{CaptureHeaders: true}))
	ctx, _ = ev.GetN("context").(types.Json)
	require.NotNil(t, ctx)
	headers, ok := ctx.GetN("headers").(map[string]string)
	require.True(t, ok, "context.headers must be set when capture is enabled")
	require.Equal(t, "cors", headers["sec-fetch-mode"])

	// s2s with capture disabled: a body-provided context.headers is left untouched
	c = ginContextWithHeaders(map[string]string{"User-Agent": "server-sdk/1.0"})
	ev = types.JsonFromMap(map[string]any{
		"event": "test",
		"context": map[string]any{"headers": map[string]any{"user-agent": "Mozilla/5.0 (device)"}},
	})
	require.NoError(t, patchEvent(c, "msg4", ev, "track", IngestTypeS2S, nil, "", &StreamWithDestinations{}))
	ctx, _ = ev.GetN("context").(types.Json)
	require.NotNil(t, ctx)
	bodyHeaders, ok := ctx.GetN("headers").(types.Json)
	require.True(t, ok)
	require.Equal(t, "Mozilla/5.0 (device)", bodyHeaders.GetS("user-agent"))

	// s2s with capture enabled: request headers captured, body overlay applied
	c = ginContextWithHeaders(map[string]string{"User-Agent": "server-sdk/1.0", "Sec-Fetch-Mode": "cors"})
	ev = types.JsonFromMap(map[string]any{
		"event": "test",
		"context": map[string]any{"headers": map[string]any{"user-agent": "Mozilla/5.0 (device)"}},
	})
	require.NoError(t, patchEvent(c, "msg5", ev, "track", IngestTypeS2S, nil, "", &StreamWithDestinations{CaptureHeaders: true}))
	ctx, _ = ev.GetN("context").(types.Json)
	require.NotNil(t, ctx)
	headers, ok = ctx.GetN("headers").(map[string]string)
	require.True(t, ok)
	require.Equal(t, "Mozilla/5.0 (device)", headers["user-agent"])
	require.Equal(t, "cors", headers["sec-fetch-mode"])
}

func TestContextHeadersSignatureAgent(t *testing.T) {
	// Web Bot Auth headers: signature-agent's value identifies the agent operator and
	// is kept; signature/signature-input are crypto material - presence only.
	c := ginContextWithHeaders(map[string]string{
		"User-Agent":      "Mozilla/5.0",
		"Signature-Agent": `"https://chatgpt.com"`,
		"Signature":       "sig1=:MEUCIQDX...:",
		"Signature-Input": `sig1=("@authority" "signature-agent")`,
	})
	headers := buildContextHeaders(c, nil, nil)
	require.Equal(t, `"https://chatgpt.com"`, headers["signature-agent"])
	require.Equal(t, maskedHeaderValue, headers["signature"])
	require.Equal(t, maskedHeaderValue, headers["signature-input"])
}
