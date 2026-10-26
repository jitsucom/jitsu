package main

import (
	"fmt"
	"strings"
	"testing"

	"github.com/jitsucom/bulker/jitsubase/appbase"
	"github.com/stretchr/testify/require"
)

type securityStreamsRepository struct {
	appbase.Repository[Streams]
	data *Streams
}

func (r securityStreamsRepository) GetData() *Streams { return r.data }

func TestS2SRequiresExplicitPrivateKey(t *testing.T) {
	const globalSecret = "test-global-secret"
	privateHash := "salt." + hashApiKey("private-secret", "salt", globalSecret)
	publicHash := "salt." + hashApiKey("public-secret", "salt", globalSecret)
	data := &StreamsRepositoryData{}
	require.NoError(t, data.Init(strings.NewReader(fmt.Sprintf(`[{"stream":{"id":"public-stream-id","workspaceId":"ws","domains":["events.example.com"],"privateKeys":[{"id":"private","hash":%q},{"plaintext":"legacy-private"}],"publicKeys":[{"id":"public","hash":%q},{"plaintext":"legacy-public"}]}}]`, privateHash, publicHash)), nil))
	r := &Router{
		Router:     &appbase.Router{Service: appbase.NewServiceBase("test")},
		config:     &Config{GlobalHashSecrets: []string{globalSecret}},
		repository: securityStreamsRepository{data: data.GetData()},
	}
	for _, ingestType := range []IngestType{IngestTypeS2S, IngestTypeWriteKeyDefined} {
		for _, s2sEndpoint := range []bool{false, true} {
			if !s2sEndpoint && ingestType == IngestTypeWriteKeyDefined {
				continue // This combination also permits browser keys.
			}
			for _, strict := range []bool{false, true} {
				for _, key := range []string{"", "public-stream-id", "legacy-public", "unknown-private", "public:public-secret", "private:wrong", "private:private-secret:extra", "private:"} {
					t.Run(fmt.Sprintf("%s/s2s=%t/strict=%t/key=%s", ingestType, s2sEndpoint, strict, key), func(t *testing.T) {
						loc := StreamCredentials{WriteKey: key, Slug: "public-stream-id", Domain: "events.example.com", IngestType: ingestType}
						require.Nil(t, r.getStream(&loc, strict, s2sEndpoint))
					})
				}
				for _, key := range []string{"private:private-secret", "legacy-private"} {
					loc := StreamCredentials{WriteKey: key, IngestType: ingestType}
					stream := r.getStream(&loc, strict, s2sEndpoint)
					require.NotNil(t, stream, "key=%s", key)
					require.Equal(t, "public-stream-id", stream.Stream.Id)
					require.Equal(t, IngestTypeS2S, loc.IngestType)
				}
			}
		}
	}
	for _, loc := range []StreamCredentials{
		{WriteKey: "public-stream-id", IngestType: IngestTypeBrowser},
		{WriteKey: "legacy-public", IngestType: IngestTypeBrowser},
		{Slug: "public-stream-id", IngestType: IngestTypeBrowser},
		{Domain: "events.example.com", IngestType: IngestTypeBrowser},
		{WriteKey: "public:public-secret", IngestType: IngestTypeBrowser},
	} {
		require.NotNil(t, r.getStream(&loc, false, false), "%+v", loc)
		require.Equal(t, IngestTypeBrowser, loc.IngestType)
	}
}

func TestPrivatePlainKeysAreScopedAndRevokedOnReload(t *testing.T) {
	data := &StreamsRepositoryData{}
	require.NoError(t, data.Init(strings.NewReader(`[{"stream":{"id":"first","privateKeys":[{"plaintext":"first-secret"}]}},{"stream":{"id":"second","privateKeys":[{"plaintext":"second-secret"}]}}]`), nil))
	require.Equal(t, "first", data.GetData().GetStreamByPrivatePlainKey("first-secret").Stream.Id)
	require.Equal(t, "second", data.GetData().GetStreamByPrivatePlainKey("second-secret").Stream.Id)
	require.Nil(t, data.GetData().GetStreamByPlainKeyOrId("first-secret"))
	require.Nil(t, data.GetData().GetStreamByPrivatePlainKey("first"))
	require.Nil(t, data.GetData().GetStreamByPrivatePlainKey(""))
	require.NoError(t, data.Init(strings.NewReader(`[{"stream":{"id":"first","privateKeys":[{"plaintext":"rotated-secret"}]}}]`), nil))
	require.Nil(t, data.GetData().GetStreamByPrivatePlainKey("first-secret"))
	require.Nil(t, data.GetData().GetStreamByPrivatePlainKey("second-secret"))
	require.Equal(t, "first", data.GetData().GetStreamByPrivatePlainKey("rotated-secret").Stream.Id)
}

func TestS2SSlugAuthWorkspaceException(t *testing.T) {
	const config = `[
 {"stream":{"id":"enabled","workspaceId":"opted-in","domains":["events.example.com"],"publicKeys":[{"plaintext":"public-alias"}],"privateKeys":[{"plaintext":"enabled-secret"}]},"s2sSlugAuth":true},
 {"stream":{"id":"disabled","workspaceId":"default","domains":["events.example.com"],"privateKeys":[{"plaintext":"disabled-secret"}]}},
 {"stream":{"id":"strict","workspaceId":"opted-in","strict":true},"s2sSlugAuth":true}
 ]`
	data := &StreamsRepositoryData{}
	require.NoError(t, data.Init(strings.NewReader(config), nil))
	r := &Router{repository: securityStreamsRepository{data: data.GetData()}}
	for _, it := range []IngestType{IngestTypeWriteKeyDefined, IngestTypeS2S} {
		for _, key := range []string{"", "unknown:secret", "unconfigured-plain", "enabled", "public-alias"} {
			loc := StreamCredentials{WriteKey: key, Slug: "enabled", IngestType: it}
			stream := r.getStream(&loc, false, true)
			require.NotNil(t, stream)
			require.Equal(t, "enabled", stream.Stream.Id)
			require.Equal(t, IngestTypeS2S, loc.IngestType)
			loc = StreamCredentials{WriteKey: key, Slug: "enabled", IngestType: it}
			require.Nil(t, r.getStream(&loc, true, true), "strict callers must still require a key")
		}
	}
	for _, loc := range []StreamCredentials{
		{Slug: "disabled", IngestType: IngestTypeS2S},
		{Slug: "strict", IngestType: IngestTypeS2S},
		{Slug: "public-alias", IngestType: IngestTypeS2S},
		{WriteKey: "enabled", IngestType: IngestTypeS2S},
		{Domain: "events.example.com", IngestType: IngestTypeS2S},
	} {
		require.Nil(t, r.getStream(&loc, false, true), "%+v", loc)
	}
	loc := StreamCredentials{Slug: "enabled", IngestType: IngestTypeS2S}
	require.NotNil(t, r.getStream(&loc, false, false), "explicit S2S type must also honor flag")
	loc = StreamCredentials{WriteKey: "disabled-secret", Slug: "enabled", IngestType: IngestTypeS2S}
	require.Equal(t, "disabled", r.getStream(&loc, false, true).Stream.Id, "valid keys take precedence over slug fallback")
	require.NoError(t, data.Init(strings.NewReader(strings.ReplaceAll(config, `"s2sSlugAuth":true`, `"s2sSlugAuth":false`)), nil))
	r.repository = securityStreamsRepository{data: data.GetData()}
	loc = StreamCredentials{Slug: "enabled", IngestType: IngestTypeS2S}
	require.Nil(t, r.getStream(&loc, false, true), "removing the flag revokes slug access on refresh")
}
