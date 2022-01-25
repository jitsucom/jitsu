package metrics

import (
	"strings"

	"github.com/jitsucom/jitsu/server/logging"
)

var (
	Enabled         = false
	DefaultRegistry *Registry
)

func Init(enabled bool) {
	Enabled = enabled
	if Enabled {
		logging.Info("✅ Initializing Prometheus metrics..")
		initEvents()
		initSourcesPool()
		initSourceObjects()
		initMetaRedis()
		initCoordinationRedis()
		initEventsRedis()
		initUsersRecognitionQueue()
		initUsersRecognitionRedis()
		initStreamEventsQueue()
	} else {
		logging.Info("❌ Prometheus metrics reporting is not enabled. Read how to enable them: https://jitsu.com/docs/other-features/application-metrics")
	}
}

func extractLabels(destinationName string) (projectID, destinationID string) {
	splitted := strings.Split(destinationName, ".")
	if len(splitted) > 1 {
		return splitted[0], splitted[1]
	}

	return "-", destinationName
}
