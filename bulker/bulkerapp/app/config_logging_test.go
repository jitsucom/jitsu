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

// A syntax error close to a credential: the HJSON error quotes a window of text around the position of the error.
func TestEnvConfigurationSourceDoesNotQuoteTheTextAroundASyntaxError(t *testing.T) {
	buf := captureLogs(t)
	t.Setenv("LOGHJ_DESTINATION_NEARBY", `{ "id": "x",, "p": "HJSON-NEAR-SECRET-5521" }`)
	viper.Set("loghjviper_nearby", `{ "id": "y",, "p": "HJSON-VIPER-SECRET-5522" }`)

	NewEnvConfigurationSource("LOGHJ_", "LOGHJVIPER")
	NewEnvConfigurationSource("LOGHJ_", "DESTINATION")

	logged := buf.String()
	for _, secret := range []string{"HJSON-NEAR", "HJSON-VIPER", "SECRET-552"} {
		if strings.Contains(logged, secret) {
			t.Errorf("the text around a syntax error reached the logs: %q\n%s", secret, logged)
		}
	}
	if !strings.Contains(logged, "Failed to parse destination config") {
		t.Errorf("the parse failure should still be logged:\n%s", logged)
	}
	// what is logged is the position of the error and not the text of the parser
	if strings.Count(logged, "syntax error at line 1, column") != 2 || strings.Contains(logged, ">>>") {
		t.Errorf("the failure should be described by its position only:\n%s", logged)
	}
}

// The YAML source logged the whole destination on a failure, and the decoder's error names the value that did not fit.
func TestYamlConfigurationSourceDoesNotLogACredential(t *testing.T) {
	buf := captureLogs(t)
	_, err := NewYamlConfigurationSource([]byte("destinations:\n  mine:\n    usesBulker: YAML-SOURCE-SECRET-6613\n    credentials:\n      password: YAML-PASSWORD-SECRET-6614\n"))
	if err != nil {
		t.Logf("source creation: %v", err)
	}
	logged := buf.String()
	if strings.Contains(logged, "YAML-SOURCE-SECRET") || strings.Contains(logged, "YAML-PASSWORD-SECRET") {
		t.Errorf("a configuration value reached the logs:\n%s", logged)
	}
	if !strings.Contains(logged, "Failed to parse destination config mine") {
		t.Errorf("the failure should still be logged with the destination id:\n%s", logged)
	}
}
