package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/jitsucom/bulker/jitsubase/uuid"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var backupShadowEvents = promauto.NewCounterVec(prometheus.CounterOpts{
	Name: "ingest_backup_shadow_events_total", Help: "Workspace archive comparison outcomes.",
}, []string{"result"})

type backupShadow struct {
	workspace, endpoint, token string
	client                     *http.Client
	slots                      chan struct{}
}

func newBackupShadow(config *Config) (*backupShadow, error) {
	if config.BackupShadowWorkspace == "" && config.BackupShadowURL == "" && config.BackupShadowToken == "" {
		return nil, nil
	}
	u, err := url.Parse(config.BackupShadowURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || config.BackupShadowWorkspace == "" || config.BackupShadowToken == "" {
		return nil, errors.New("backup shadow requires a writer URL, token and workspace")
	}
	endpoint := strings.TrimRight(u.String(), "/") + "/v1/archive/" + url.PathEscape(config.BackupShadowWorkspace)
	return &backupShadow{workspace: config.BackupShadowWorkspace, endpoint: endpoint, token: config.BackupShadowToken,
		client: &http.Client{Timeout: 2 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, slots: make(chan struct{}, 8)}, nil
}

// Shadow traffic has a fixed concurrency budget and cannot delay Kafka admission.
// In-flight comparison requests may be abandoned when ingest exits.
func (s *backupShadow) copy(workspace string, data []byte) {
	if s == nil || s.workspace != workspace {
		return
	}
	select {
	case s.slots <- struct{}{}:
	default:
		backupShadowEvents.WithLabelValues("busy").Inc()
		return
	}
	go func() {
		defer func() { <-s.slots }()
		key := uuid.New()
		for attempt := 0; attempt < 2; attempt++ {
			retry, err := s.send(context.Background(), key, data)
			if err == nil {
				backupShadowEvents.WithLabelValues("accepted").Inc()
				return
			}
			if !retry {
				break
			}
		}
		backupShadowEvents.WithLabelValues("failed").Inc()
	}()
}
func (s *backupShadow) send(ctx context.Context, key string, data []byte) (bool, error) {
	req, err := http.NewRequestWithContext(ctx, "POST", s.endpoint, bytes.NewReader(data))
	if err != nil {
		return false, err
	}
	req.Header.Set("Authorization", "Bearer "+s.token)
	req.Header.Set("Idempotency-Key", key)
	req.Header.Set("Content-Type", "application/x-ndjson")
	res, err := s.client.Do(req)
	if err != nil {
		return true, err
	}
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 4096))
	if res.StatusCode != http.StatusNoContent {
		return res.StatusCode >= 500, fmt.Errorf("archive writer returned %d", res.StatusCode)
	}
	return false, nil
}
