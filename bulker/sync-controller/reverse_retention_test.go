package main

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

// The console names the workspace's retention bucket in the run configuration (JITSU-242). Every path that writes
// reverse.json (cron Secret, manual run, recovery, the cached feed) marshals ReverseConfig, so a field missing from the
// struct is silently dropped and the runner stores rows in the shared bucket with no expiry.

const retentionFeed = `[{"version":1,"kind":"reverse","id":"retl-sync","workspaceId":"ws1","fromId":"model","toId":"destination",` +
	`"configRevision":"%s","updatedAt":"2026-10-05T12:00:00.000Z","timezone":"Etc/UTC","model":{"query":"SELECT id FROM t"},` +
	`"warehouse":{"destinationType":"postgres"},"destination":{"destinationType":"webhook"},"options":{"mode":"upsert"}%s}]`

func retentionFeedJSON(retention string) string {
	return strings.Replace(strings.Replace(retentionFeed, "%s", strings.Repeat("a", 64), 1), "%s", retention, 1)
}

func loadReverse(t *testing.T, feed string) *ReverseConfig {
	t.Helper()
	repo := &SyncsRepositoryData{reverse: true}
	if err := repo.Init(strings.NewReader(feed), nil); err != nil {
		t.Fatal(err)
	}
	entry := repo.GetData().BySyncID["retl-sync"]
	if entry == nil || entry.Reverse == nil {
		t.Fatal("sync was not loaded")
	}
	return entry.Reverse
}

func TestReverseRetentionReachesReverseJSON(t *testing.T) {
	config := loadReverse(t, retentionFeedJSON(`,"retention":{"bucket":"jitsu-retl-ws1"}`))
	raw, err := json.Marshal(config)
	if err != nil {
		t.Fatal(err)
	}
	var written map[string]json.RawMessage
	if err := json.Unmarshal(raw, &written); err != nil {
		t.Fatal(err)
	}
	if string(written["retention"]) != `{"bucket":"jitsu-retl-ws1"}` {
		t.Fatalf("reverse.json lost the retention bucket: %s", raw)
	}
}

func TestReverseRetentionSurvivesTheCachedFeed(t *testing.T) {
	repo := &SyncsRepositoryData{reverse: true}
	if err := repo.Init(strings.NewReader(retentionFeedJSON(`,"retention":{"bucket":"jitsu-retl-ws1"}`)), nil); err != nil {
		t.Fatal(err)
	}
	var cached bytes.Buffer
	if err := repo.Store(&cached); err != nil {
		t.Fatal(err)
	}
	restored := &SyncsRepositoryData{reverse: true}
	if err := restored.Init(&cached, nil); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(restored.GetData().BySyncID["retl-sync"].Reverse)
	if !strings.Contains(string(raw), `"retention":{"bucket":"jitsu-retl-ws1"}`) {
		t.Fatalf("the cached feed lost the retention bucket: %s", raw)
	}
}

// A sync without retention (every Google sync, and anything exported before this field) must write exactly what it
// wrote before: no new key, so no Secret churn and no behaviour change.
func TestReverseWithoutRetentionIsUnchanged(t *testing.T) {
	raw, _ := json.Marshal(loadReverse(t, retentionFeedJSON("")))
	if strings.Contains(string(raw), "retention") {
		t.Fatalf("a sync without retention gained a retention key: %s", raw)
	}
}

// The runner validates the bucket name itself. A shape Go does not understand must pass through untouched and never
// make the whole feed invalid, because one invalid entry rejects the feed for every sync.
func TestReverseRetentionIsPassedThroughVerbatim(t *testing.T) {
	config := loadReverse(t, retentionFeedJSON(`,"retention":{"bucket":42,"extra":true}`))
	raw, _ := json.Marshal(config)
	if !strings.Contains(string(raw), `"retention":{"bucket":42,"extra":true}`) {
		t.Fatalf("retention was altered: %s", raw)
	}
}
