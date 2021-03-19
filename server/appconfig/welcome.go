package appconfig

import "github.com/jitsucom/eventnative/server/logging"

func logWelcomeBanner(version string) {
	logging.Infof("\nWelcome to EventNative %s developed by Jitsu (https://jitsu.com)\n  * Documentation: https://docs.eventnative.org/\n", version)
}
