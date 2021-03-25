package appconfig

import (
	"github.com/jitsucom/jitsu/server/logging"
)

const banner = "\n========================================================================\n\n" +
	"Welcome to EventNative %s!\n\n" +
	"EventNative is a data collection platform developed by Jitsu\n\n" +
	" 📚 Documentation: https://docs.eventnative.org/\n" +
	" 🌎 Website: https://jitsu.com\n" +
	" 💪 Follow us on twitter: https://twitter.com/jitsucom\n" +
	" 💬 Join our Slack: https://jitsu.com/slack\n\n" +
	"========================================================================\n"

func logWelcomeBanner(version string) {
	logging.Infof(banner, version)
}
