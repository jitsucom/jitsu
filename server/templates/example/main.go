package main

import (
	"fmt"

	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/templates"
)

func main() {
	logging.LogLevel = logging.DEBUG
	expression := "return {...$, hello: $.id}"
	executor, err := templates.NewNodeExecutor(templates.NodeSysV, expression)
	if err != nil {
		panic(err)
	}

	defer executor.Close()

	for i := 0; i < 109; i++ {
		result, err := executor.ProcessEvent(events.Event{"id": i})
		if err != nil {
			logging.Fatal(err)
		}

		if fmt.Sprint(i) != fmt.Sprint(result.(map[string]interface{})["hello"]) {
			logging.Fatal("%v must be %d", result, i)
		}
	}
}
