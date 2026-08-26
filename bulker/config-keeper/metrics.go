package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jitsucom/bulker/jitsubase/appbase"
	"github.com/jitsucom/bulker/jitsubase/safego"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Config-keeper exposes these to Prometheus so a deploy that shrinks or blanks
// a config export is visible as a live gauge (JITSU-191 post-rollout
// baselines). Before this, config-keeper published no metrics at all and the
// only per-repository size signal was bulker's add/change/remove event
// counter, which cannot express "how many rows does the export have now".
var (
	// repositoryRows is the number of top-level JSON array elements in the
	// last payload config-keeper actually SERVED for a repository. A sharp
	// drop after a console deploy is the JITSU-158 blank/lost-config signal;
	// while a breaker holds last-known-good this keeps reporting the held
	// (good) size, not the rejected one.
	repositoryRows = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Namespace: "cfgkpr",
		Subsystem: "repository",
		Name:      "rows",
		Help:      "Number of rows (top-level JSON array elements) in the last served repository payload.",
	}, []string{"repository"})

	// repositoryBreakerHeld is 1 while a repository's circuit breaker is
	// holding last-known-good (rejecting new generations), 0 otherwise.
	repositoryBreakerHeld = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Namespace: "cfgkpr",
		Subsystem: "repository",
		Name:      "breaker_held",
		Help:      "1 when the repository circuit breaker is holding last-known-good, 0 otherwise.",
	}, []string{"repository"})
)

// recordRepositoryRows counts top-level JSON array elements of a served
// payload and publishes the gauge. Non-array payloads (e.g. the p.js script)
// are skipped — they have no row concept.
func recordRepositoryRows(name string, data []byte) {
	if name == "" {
		return
	}
	var rows []json.RawMessage
	if err := json.Unmarshal(data, &rows); err != nil {
		return
	}
	repositoryRows.WithLabelValues(name).Set(float64(len(rows)))
}

func setRepositoryRows(name string, count int) {
	if name == "" {
		return
	}
	repositoryRows.WithLabelValues(name).Set(float64(count))
}

func setBreakerHeld(name string, held bool) {
	v := 0.0
	if held {
		v = 1.0
	}
	repositoryBreakerHeld.WithLabelValues(name).Set(v)
}

type MetricsServer struct {
	appbase.Service
	server *http.Server
}

func NewMetricsServer(port int) *MetricsServer {
	base := appbase.NewServiceBase("metrics_server")
	engine := gin.New()
	engine.Use(gin.Recovery())
	engine.GET("/metrics", gin.WrapH(promhttp.Handler()))
	server := &http.Server{
		Addr:              fmt.Sprintf("0.0.0.0:%d", port),
		Handler:           engine,
		ReadTimeout:       time.Second * 60,
		ReadHeaderTimeout: time.Second * 60,
		IdleTimeout:       time.Second * 65,
	}
	m := &MetricsServer{Service: base, server: server}
	safego.RunWithRestart(func() {
		m.Infof("Starting metrics server on %s", server.Addr)
		m.Infof("%v", server.ListenAndServe())
	})
	return m
}

func (s *MetricsServer) Stop() error {
	if s.server == nil {
		return nil
	}
	return s.server.Shutdown(context.Background())
}
