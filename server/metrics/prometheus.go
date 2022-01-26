package metrics

import (
	"os"
	"strings"
	"time"

	"github.com/jitsucom/jitsu/server/logging"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/spf13/viper"
)

var Exported bool

var Registry *prometheus.Registry

func Enabled() bool {
	return Registry != nil
}

func NewCounterVec(opts prometheus.CounterOpts, labels []string) *prometheus.CounterVec {
	vec := prometheus.NewCounterVec(opts, labels)
	Registry.MustRegister(vec)
	return vec
}

func NewGaugeVec(opts prometheus.GaugeOpts, labels []string) *prometheus.GaugeVec {
	vec := prometheus.NewGaugeVec(opts, labels)
	Registry.MustRegister(vec)
	return vec
}

const Unknown = "unknown"

func Init(exported bool) {
	logging.Info("✅ Initializing Prometheus metrics..")

	Exported = exported
	Registry = prometheus.NewRegistry()
	Registry.MustRegister(
		collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}),
		collectors.NewGoCollector(),
	)

	initEvents()
	initSourcesPool()
	initSourceObjects()
	initMetaRedis()
	initCoordinationRedis()
	initEventsRedis()
	initUsersRecognitionQueue()
	initUsersRecognitionRedis()
	initStreamEventsQueue()
}

func InitRelay(clusterID string, viper *viper.Viper) *Relay {
	if viper.GetBool("disabled") {
		logging.Debugf("Metrics relay is disabled")
		return nil
	}

	url := viper.GetString("url")
	if url == "" {
		url = DefaultRelayURL
		return nil
	}

	deploymentID := viper.GetString("deployment_id")
	if deploymentID == "" {
		deploymentID = clusterID
	}

	hostID, err := os.Hostname()
	if err != nil {
		logging.Debugf("Failed to get hostname for metrics relay, using '%s': %s", Unknown, err)
		hostID = Unknown
	}

	timeout := time.Second
	if viper.IsSet("timeout") {
		timeout = viper.GetDuration("timeout")
	}

	relay := Relay{
		URL:          url,
		HostID:       hostID,
		DeploymentID: deploymentID,
		Timeout:      timeout,
	}

	logging.Debugf("✅ Initialized metrics relay to %s as [host: %s, deployment: %s]",
		relay.URL, relay.HostID, relay.DeploymentID)
	return &relay
}

func extractLabels(destinationName string) (projectID, destinationID string) {
	splitted := strings.Split(destinationName, ".")
	if len(splitted) > 1 {
		return splitted[0], splitted[1]
	}

	return "-", destinationName
}
