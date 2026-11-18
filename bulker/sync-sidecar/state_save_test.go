package main

import (
	"context"
	"errors"
	"strings"
	"testing"

	bulker "github.com/jitsucom/bulker/bulkerlib"
	"github.com/jitsucom/bulker/bulkerlib/types"
)

// rejectingStream is a destination stream whose commit fails, as the guarded webhook writer does when it refuses to
// connect to a local address.
type rejectingStream struct{ err error }

func (r *rejectingStream) Consume(context.Context, types.Object) (bulker.State, types.Object, error) {
	return bulker.State{}, nil, nil
}
func (r *rejectingStream) ConsumeJSON(context.Context, []byte) (bulker.State, types.Object, error) {
	return bulker.State{}, nil, nil
}
func (r *rejectingStream) ConsumeMap(context.Context, map[string]any) (bulker.State, types.Object, error) {
	return bulker.State{}, nil, nil
}
func (r *rejectingStream) Abort(context.Context) bulker.State { return bulker.State{} }
func (r *rejectingStream) Complete(context.Context) (bulker.State, error) {
	return bulker.State{}, r.err
}

// The link before the state check: a commit the destination rejects ends up as an error on the stream only. The
// task-level error stays empty, which is exactly why the old GLOBAL/LEGACY check let the checkpoint through.
func TestRejectedCommitBlocksGlobalAndLegacyState(t *testing.T) {
	st := NewActiveStream("orders", "incremental", bulker.Batch)
	if err := st.Begin(&rejectingStream{err: errors.New("connection to a non-public address is not allowed")}); err != nil {
		t.Fatal(err)
	}
	st.Commit(false)
	if st.Error == "" {
		t.Fatal("a rejected commit must be recorded on the stream")
	}
	s := stateTestSidecar("", map[string]*ActiveStream{"orders": st})
	if s.isErr() {
		t.Fatal("test premise: a rejected commit does not set the task-level error")
	}
	for _, state := range []string{"_GLOBAL_STATE", "_LEGACY_STATE"} {
		if reason := s.stateSaveBlocker(state); reason == "" {
			t.Fatalf("%s must not be saved after a rejected commit", state)
		}
	}
}

func stateTestSidecar(packageName string, streams map[string]*ActiveStream) *ReadSideCar {
	return &ReadSideCar{
		AbstractSideCar:  &AbstractSideCar{logLevel: "INFO", dbLogLevel: "ERROR", packageName: packageName},
		processedStreams: streams,
	}
}

func healthyStream(name string) *ActiveStream {
	return NewActiveStream(name, "incremental", bulker.Batch)
}

// failedStream is a stream whose upload to the destination was rejected (for example a webhook the guard refused). The
// error is recorded on the stream only; it does not set the task-level error.
func failedStream(name string) *ActiveStream {
	st := NewActiveStream(name, "incremental", bulker.Batch)
	st.RegisterError(errors.New("connection to a non-public address is not allowed"))
	return st
}

// GLOBAL and LEGACY state cover every stream of the sync. If a stream's records were not delivered, saving that state
// moves the cursor past them, and the next run skips them for good (JITSU-258 review). Per-stream state already refused
// to be saved for a failed stream; these two state types have to refuse as well.
func TestStateSaveBlocker(t *testing.T) {
	const globalState, legacyState = "_GLOBAL_STATE", "_LEGACY_STATE"
	cases := []struct {
		name        string
		pkg         string
		streams     map[string]*ActiveStream
		taskErr     error
		stream      string
		wantBlocked bool
		wantInText  string
	}{
		// per-stream state: unchanged behaviour
		{name: "stream state, healthy stream", streams: map[string]*ActiveStream{"a": healthyStream("a")}, stream: "a"},
		{name: "stream state, failed stream", streams: map[string]*ActiveStream{"a": failedStream("a")}, stream: "a", wantBlocked: true, wantInText: "previous errors"},
		{name: "stream state, stream never processed", streams: map[string]*ActiveStream{}, stream: "a", wantBlocked: true, wantInText: "not processed"},
		{name: "stream state, another stream failed", streams: map[string]*ActiveStream{"a": healthyStream("a"), "b": failedStream("b")}, stream: "a"},

		// global and legacy state: unchanged behaviour
		{name: "global state, healthy streams", streams: map[string]*ActiveStream{"a": healthyStream("a"), "b": healthyStream("b")}, stream: globalState},
		{name: "global state, nothing processed yet", streams: map[string]*ActiveStream{}, stream: globalState},
		{name: "global state, task-level error", streams: map[string]*ActiveStream{"a": healthyStream("a")}, taskErr: errors.New("connector crashed"), stream: globalState, wantBlocked: true, wantInText: "previous errors"},
		{name: "legacy state, task-level error", streams: map[string]*ActiveStream{"a": healthyStream("a")}, taskErr: errors.New("connector crashed"), stream: legacyState, wantBlocked: true, wantInText: "previous errors"},
		{name: "global state, task-level error on netsuite is tolerated", pkg: "airbyte/source-netsuite", streams: map[string]*ActiveStream{"a": healthyStream("a")}, taskErr: errors.New("x"), stream: globalState},

		// the fix: a failed stream blocks global and legacy state
		{name: "global state, one stream failed", streams: map[string]*ActiveStream{"a": healthyStream("a"), "b": failedStream("b")}, stream: globalState, wantBlocked: true, wantInText: "'b'"},
		{name: "legacy state, one stream failed", streams: map[string]*ActiveStream{"a": failedStream("a")}, stream: legacyState, wantBlocked: true, wantInText: "'a'"},
		{name: "global state, all streams failed", streams: map[string]*ActiveStream{"a": failedStream("a"), "b": failedStream("b")}, stream: globalState, wantBlocked: true},
		{name: "global state, a nil entry is ignored", streams: map[string]*ActiveStream{"a": nil, "b": healthyStream("b")}, stream: globalState},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := stateTestSidecar(tc.pkg, tc.streams)
			if tc.taskErr != nil {
				s.registerErr(tc.taskErr)
			}
			got := s.stateSaveBlocker(tc.stream)
			if (got != "") != tc.wantBlocked {
				t.Fatalf("stateSaveBlocker(%q) = %q, blocked=%t, want blocked=%t", tc.stream, got, got != "", tc.wantBlocked)
			}
			if tc.wantInText != "" && !strings.Contains(got, tc.wantInText) {
				t.Fatalf("stateSaveBlocker(%q) = %q, want it to mention %q", tc.stream, got, tc.wantInText)
			}
		})
	}
}
