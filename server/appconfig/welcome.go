package appconfig

import (
	"github.com/jitsucom/jitsu/server/logging"
	"strings"
)

func logWelcomeBanner(version string) {
	logging.Infof("\nWelcome to EventNative %s developed by Jitsu (https://jitsu.com)\n  * Documentation: https://docs.eventnative.org/\n", version)
}

func logDeprecatedImageUsage(dockerHubID string) {
	//check usage of deprecated image
	if strings.TrimSpace(dockerHubID) == "ksense" {
		logging.Warnf("\n\n\t *** ksense/eventnative docker image is DEPRECATED. Please use jitsucom/server. For more details read https://jitsu.com/docs/deployment/deploy-with-docker ***\n")
	}
}
