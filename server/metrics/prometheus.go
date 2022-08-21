package metrics

import (
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/jitsucom/jitsu/server/logging"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/spf13/viper"
)

const (
	TokenSourceType = "token"
	EmptySourceTap  = ""
)

var Exported bool

var Registry *prometheus.Registry

func Enabled() bool {
	return Registry != nil
}

func NewCounter(opts prometheus.CounterOpts) *prometheus.Counter {
	counter := prometheus.NewCounter(opts)
	Registry.MustRegister(counter)
	return &counter
}

func NewCounterVec(opts prometheus.CounterOpts, labels []string) *prometheus.CounterVec {
	vec := prometheus.NewCounterVec(opts, labels)
	Registry.MustRegister(vec)
	return vec
}

func NewGauge(opts prometheus.GaugeOpts) *prometheus.Gauge {
	gauge := prometheus.NewGauge(opts)
	Registry.MustRegister(gauge)
	return &gauge
}

func NewGaugeVec(opts prometheus.GaugeOpts, labels []string) *prometheus.GaugeVec {
	vec := prometheus.NewGaugeVec(opts, labels)
	Registry.MustRegister(vec)
	return vec
}

const Unknown = "unknown"

func initRegistry(exported bool) {
	Exported = exported
	if Exported {
		logging.Info("✅ Initializing Prometheus metrics.")
	}

	Registry = prometheus.DefaultRegisterer.(*prometheus.Registry)
}

func InitMain(exported bool) {
	initRegistry(exported)

	initApplication()
	initAuthorization()
	initCoordinationRedis()
	initDestinations()
	initEvents()
	initEventsRedis()
	initMetaRedis()
	initNotifications()
	initSourceObjects()
	initSources()
	initSourcesPool()
	initStreamEventsQueue()
	initUsersRecognitionQueue()
	initUsersRecognitionRedis()
}

func InitConfigurator(exported bool) {
	initRegistry(exported)

	initApplication()
	initEmails()
	initNotifications()
}

func InitReplay(exported bool) {
	initRegistry(exported)

	initApplication()
	initFileSending()
}

func InitRelay(clusterID string, viper *viper.Viper) *Relay {
	relay := &Relay{
		URL:          DefaultRelayURL,
		HostID:       Unknown,
		DeploymentID: clusterID,
		Timeout:      5 * time.Second,
	}

	hostID, err := os.Hostname()
	if err != nil {
		logging.Debugf("Failed to get hostname for metrics relay, using '%s': %s", Unknown, err)
	} else {
		relay.HostID = hostID
	}

	if viper != nil {
		if viper.GetBool("disabled") {
			logging.Debugf("Metrics relay is disabled")
			return nil
		}

		url := viper.GetString("url")
		if url != "" {
			relay.URL = url
		}

		deploymentID := viper.GetString("deployment_id")
		if deploymentID != "" {
			relay.DeploymentID = deploymentID
		}

		if viper.IsSet("timeout") {
			relay.Timeout = viper.GetDuration("timeout")
		}
	}

	logging.Debugf("✅ Initialized metrics relay to %s as [host: %s, deployment: %s]",
		relay.URL, relay.HostID, relay.DeploymentID)
	return relay
}

func Handler() http.Handler {
	return promhttp.InstrumentMetricHandler(
		Registry, promhttp.HandlerFor(Registry, promhttp.HandlerOpts{}),
	)
}

func extractLabels(destinationName string) (projectID, destinationID string) {
	splitted := strings.Split(destinationName, ".")
	if len(splitted) > 1 {
		return splitted[0], splitted[1]
	}

	return "-", destinationName
}
