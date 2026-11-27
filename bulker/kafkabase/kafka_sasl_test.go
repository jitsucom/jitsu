package kafkabase

import (
	"fmt"
	"strings"
	"testing"
)

// JITSU-302: the SASL setting holds the username and the password of the brokers. Failing to parse it stops the service
// with a panic, and the text of that panic goes to the logs: it must say where the setting is wrong, not quote it.
func TestKafkaSASLParseFailureDoesNotQuoteTheSetting(t *testing.T) {
	cfg := &KafkaConfig{KafkaBootstrapServers: "localhost:9092", KafkaSASL: `{ "username": "u", ,, "password": "SASL-SECRET-VALUE-3318" }`}
	defer func() {
		r := recover()
		if r == nil {
			t.Fatalf("a malformed SASL setting should stop the service")
		}
		msg := fmt.Sprint(r)
		if strings.Contains(msg, "SASL-SECRET") || strings.Contains(msg, ">>>") {
			t.Errorf("the panic quotes the setting: %s", msg)
		}
		if !strings.Contains(msg, "error parsing Kafka SASL config: syntax error at line 1, column") {
			t.Errorf("the panic should say where the setting is wrong: %s", msg)
		}
	}()
	cfg.GetKafkaConfig()
}
