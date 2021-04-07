package appconfig

import (
	"strings"

	"github.com/jitsucom/jitsu/server/logging"
)

const banner = "\n========================================================================\n\n" +
	"Welcome to Jitsu Server %s!\n\n" +
	"Jitsu is an open-source data collection platform developed\n\n" +
	" 📚 Documentation: https://jitsu.com/docs\n" +
	" 🌎 Website: https://jitsu.com\n" +
	" 💪 Follow us on twitter: https://twitter.com/jitsucom\n" +
	" 💬 Join our Slack: https://jitsu.com/slack\n\n" +
	"========================================================================\n"

func logWelcomeBanner(version string) {
	logging.Infof(banner, version)
}

func logDeprecatedImageUsage(dockerHubID string) {
	//check usage of deprecated image
	if strings.TrimSpace(dockerHubID) == "ksense" {
		logging.Warnf("\n\n\t *** ksense/eventnative docker image is DEPRECATED. Please use jitsucom/server. For more details read https://jitsu.com/docs/deployment/deploy-with-docker ***\n")
	}
}
