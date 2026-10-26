package main

import (
	"strings"
	"testing"

	"github.com/jitsucom/bulker/jitsubase/appbase"
	"github.com/stretchr/testify/require"
)

// streamsRepoStub serves a fixed Streams snapshot; the embedded interface is left nil on purpose
type streamsRepoStub struct {
	appbase.Repository[Streams]
	streams *Streams
}

func (s *streamsRepoStub) GetData() *Streams { return s.streams }

func newS2STestRouter(t *testing.T, streamsJSON string) *Router {
	data := &StreamsRepositoryData{}
	require.NoError(t, data.Init(strings.NewReader(streamsJSON), nil))
	return &Router{repository: &streamsRepoStub{streams: data.GetData()}}
}

const s2sTestStreams = `[
  {"stream": {"id": "stream1", "workspaceId": "ws1", "domains": ["t.victim.com"], "strict": false,
     "privateKeys": [{"id": "k1", "hash": "h", "plaintext": "plain-s2s-key"}]}},
  {"stream": {"id": "strictStream", "workspaceId": "ws2", "strict": true}}
]`

func TestS2SStreamIdIsNotAWriteKey(t *testing.T) {
	r := newS2STestRouter(t, s2sTestStreams)

	for _, strict := range []bool{true, false} {
		// the stream id is public (<streamId>.d.jitsu.com), so it must not authenticate s2s requests
		loc := &StreamCredentials{WriteKey: "stream1", IngestType: IngestTypeS2S}
		require.Nil(t, r.getStream(loc, strict, true), "stream id as s2s write key, strict=%v", strict)
	}
}

func TestS2SSlugAndDomainDoNotAuthenticate(t *testing.T) {
	r := newS2STestRouter(t, s2sTestStreams)

	// /api/s/s2s/track resolves with strict=false: a bare slug or domain must not be enough on an s2s endpoint
	require.Nil(t, r.getStream(&StreamCredentials{Slug: "stream1", IngestType: IngestTypeS2S}, false, true), "slug only")
	require.Nil(t, r.getStream(&StreamCredentials{Domain: "t.victim.com", IngestType: IngestTypeS2S}, false, true), "domain only")
	require.Nil(t, r.getStream(&StreamCredentials{Slug: "stream1", WriteKey: "stream1", IngestType: IngestTypeS2S}, false, true), "slug and stream id as key")
}

func TestS2SPrivateKeyStillWorks(t *testing.T) {
	r := newS2STestRouter(t, s2sTestStreams)

	loc := &StreamCredentials{WriteKey: "plain-s2s-key", IngestType: IngestTypeS2S}
	stream := r.getStream(loc, false, true)
	require.NotNil(t, stream)
	require.Equal(t, "stream1", stream.Stream.Id)
}
