package main

import (
	"os"

	"github.com/jitsucom/bulker/jitsubase/appbase"
)

func main() {
	settings := &appbase.AppSettings{
		ConfigPath: os.Getenv("OPERATOR_CONFIG_PATH"),
		Name:       "operator",
		EnvPrefix:  "OPERATOR",
		ConfigName: "operator",
		ConfigType: "env",
	}
	application := appbase.NewApp[Config](&Context{}, settings)
	application.Run()
}
