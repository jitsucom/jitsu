package app

import (
	"bytes"
	"strings"
	"testing"

	"github.com/sirupsen/logrus"
	"github.com/spf13/viper"
)

// JITSU-302: a destination configuration holds credentials. Neither its text (when it fails to parse) nor the parsed
// structure may reach the logs, at any level.
func captureLogs(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	oldOut, oldLevel := logrus.StandardLogger().Out, logrus.GetLevel()
	logrus.SetOutput(&buf)
	logrus.SetLevel(logrus.DebugLevel)
	t.Cleanup(func() {
		logrus.SetOutput(oldOut)
		logrus.SetLevel(oldLevel)
	})
	return &buf
}

func TestEnvConfigurationSourceDoesNotLogACredential(t *testing.T) {
	buf := captureLogs(t)
	t.Setenv("LOGTEST_DESTINATION_BROKEN", `{ "id": "broken", "credentials": { "password": "BROKEN-CFG-SECRET-VALUE" `)
	t.Setenv("LOGTEST_DESTINATION_GOOD", `{ "id": "good", "type": "postgres", "usesBulker": true, "credentials": { "password": "GOOD-CFG-SECRET-VALUE" } }`)

	src := NewEnvConfigurationSource("LOGTEST_", "DESTINATION")

	logged := buf.String()
	for _, secret := range []string{"BROKEN-CFG-SECRET-VALUE", "GOOD-CFG-SECRET-VALUE"} {
		if strings.Contains(logged, secret) {
			t.Errorf("a configuration value reached the logs: %q\n%s", secret, logged)
		}
	}
	// the operator still learns which destination failed and which one loaded
	if !strings.Contains(logged, "Failed to parse destination config") {
		t.Errorf("the parse failure should still be logged:\n%s", logged)
	}
	if !strings.Contains(logged, "BROKEN") {
		t.Errorf("the failure should name the destination:\n%s", logged)
	}
	if src.GetDestinationConfig("good") == nil {
		t.Errorf("the valid destination should still load")
	}
}

// the second place the source reads from: keys of the configuration library, not the environment
func TestEnvConfigurationSourceViperKeysDoNotLogACredential(t *testing.T) {
	buf := captureLogs(t)
	viper.Set("logvipertest_broken", `{ "id": "vbroken", "credentials": { "password": "VIPER-BROKEN-SECRET-VALUE" `)
	viper.Set("logvipertest_good", `{ "id": "vgood", "type": "postgres", "usesBulker": true, "credentials": { "password": "VIPER-GOOD-SECRET-VALUE" } }`)

	src := NewEnvConfigurationSource("LOGVIPER_", "LOGVIPERTEST")

	logged := buf.String()
	for _, secret := range []string{"VIPER-BROKEN-SECRET-VALUE", "VIPER-GOOD-SECRET-VALUE"} {
		if strings.Contains(logged, secret) {
			t.Errorf("a configuration value reached the logs: %q\n%s", secret, logged)
		}
	}
	if !strings.Contains(logged, "Failed to parse destination config") {
		t.Errorf("the parse failure should still be logged:\n%s", logged)
	}
	if src.GetDestinationConfig("vgood") == nil {
		t.Errorf("the valid destination should still load")
	}
}
