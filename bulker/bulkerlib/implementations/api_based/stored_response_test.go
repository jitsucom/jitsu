package api_based

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"

	types2 "github.com/jitsucom/bulker/bulkerlib/types"
	"github.com/stretchr/testify/require"
)

// fakeImplementation stands in for a destination that answers with a fixed status and body.
type fakeImplementation struct {
	status int
	resp   string
	err    error
}

func (f *fakeImplementation) Close() error { return nil }
func (f *fakeImplementation) Type() string { return "fake" }
func (f *fakeImplementation) Upload(io.Reader, string, int, map[string]any) (int, string, error) {
	return f.status, f.resp, f.err
}
func (f *fakeImplementation) GetBatchFileFormat() types2.FileFormat { return types2.FileFormatNDJSON }
func (f *fakeImplementation) GetBatchFileCompression() types2.FileCompression {
	return types2.FileCompressionNONE
}
func (f *fakeImplementation) InmemoryBatch() bool { return true }

// The stream, not only the helper: what a destination answered is cut before it is stored in the task state or put in
// the error that goes back to the person who configured the destination.
func TestStreamStoresACutDownResponse(t *testing.T) {
	long := strings.Repeat("x", 4000)
	complete := func(impl *fakeImplementation) (map[string]any, error) {
		stream, err := NewTransactionalStream("t", impl, "events")
		require.NoError(t, err)
		_, _, err = stream.ConsumeMap(context.Background(), map[string]any{"a": 1})
		require.NoError(t, err)
		state, err := stream.Complete(context.Background())
		representation, _ := state.Representation.(map[string]any)
		return representation, err
	}

	representation, err := complete(&fakeImplementation{status: 200, resp: long})
	require.NoError(t, err)
	stored := representation["response"].(string)
	require.Equal(t, shortResponse(long), stored)
	require.Less(t, len(stored), 600)

	_, err = complete(&fakeImplementation{status: 500, resp: long, err: errors.New("boom")})
	require.Error(t, err)
	require.Contains(t, err.Error(), shortResponse(long))
	require.NotContains(t, err.Error(), long)
	require.Less(t, len(err.Error()), 800)
}
