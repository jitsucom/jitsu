package eventslog

import (
	"github.com/jitsucom/bulker/jitsubase/appbase"
)

type EventsLogConfig struct {
	ClickhouseURL      string `mapstructure:"CLICKHOUSE_URL"`
	ClickhouseHost     string `mapstructure:"CLICKHOUSE_HOST"`
	ClickhouseDatabase string `mapstructure:"CLICKHOUSE_DATABASE"`
	ClickhouseUsername string `mapstructure:"CLICKHOUSE_USERNAME"`
	ClickhousePassword string `mapstructure:"CLICKHOUSE_PASSWORD"`
	ClickhouseSSL      bool   `mapstructure:"CLICKHOUSE_SSL"`
}

// Implement ClickhouseEnvVars interface
func (e *EventsLogConfig) GetClickhouseURL() string      { return e.ClickhouseURL }
func (e *EventsLogConfig) GetClickhouseHost() string     { return e.ClickhouseHost }
func (e *EventsLogConfig) GetClickhouseUsername() string { return e.ClickhouseUsername }
func (e *EventsLogConfig) GetClickhousePassword() string { return e.ClickhousePassword }
func (e *EventsLogConfig) GetClickhouseDatabase() string { return e.ClickhouseDatabase }
func (e *EventsLogConfig) GetClickhouseSSL() bool        { return e.ClickhouseSSL }

func (e *EventsLogConfig) PostInit(settings *appbase.AppSettings) error {
	return nil
}
