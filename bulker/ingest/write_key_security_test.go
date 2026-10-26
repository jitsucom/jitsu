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

func TestS2SRequiresHashedPrivateKey(t *testing.T) {
	const globalSecret = "test-global-secret"
	privateHash := "salt." + hashApiKey("private-secret", "salt", globalSecret)
	publicHash := "salt." + hashApiKey("public-secret", "salt", globalSecret)
	data := &StreamsRepositoryData{}
	require.NoError(t, data.Init(strings.NewReader(fmt.Sprintf(`[{"stream":{"id":"public-stream-id","workspaceId":"ws","domains":["events.example.com"],"privateKeys":[{"id":"private","hash":%q},{"plaintext":"legacy-private"}],"publicKeys":[{"id":"public","hash":%q}]}}]`, privateHash, publicHash)), nil))
	r := &Router{
		Router:     &appbase.Router{Service: appbase.NewServiceBase("test")},
		config:     &Config{GlobalHashSecrets: []string{globalSecret}},
		repository: securityStreamsRepository{data: data.GetData()},
	}
	for _, ingestType := range []IngestType{IngestTypeS2S, IngestTypeWriteKeyDefined} {
		for _, strict := range []bool{false, true} {
			for _, key := range []string{"", "public-stream-id", "legacy-private", "public:public-secret", "private:wrong", "private:private-secret:extra", "private:"} {
				t.Run(fmt.Sprintf("%s/strict=%t/key=%s", ingestType, strict, key), func(t *testing.T) {
					loc := StreamCredentials{WriteKey: key, Slug: "public-stream-id", Domain: "events.example.com", IngestType: ingestType}
					require.Nil(t, r.getStream(&loc, strict, true))
				})
			}
			loc := StreamCredentials{WriteKey: "private:private-secret", IngestType: ingestType}
			require.NotNil(t, r.getStream(&loc, strict, true))
			require.Equal(t, IngestTypeS2S, loc.IngestType)
		}
	}
	for _, loc := range []StreamCredentials{
		{WriteKey: "public-stream-id", IngestType: IngestTypeBrowser},
		{Slug: "public-stream-id", IngestType: IngestTypeBrowser},
		{Domain: "events.example.com", IngestType: IngestTypeBrowser},
		{WriteKey: "public:public-secret", IngestType: IngestTypeBrowser},
	} {
		require.NotNil(t, r.getStream(&loc, false, false), "%+v", loc)
		require.Equal(t, IngestTypeBrowser, loc.IngestType)
	}
}
