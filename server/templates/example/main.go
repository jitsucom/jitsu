package main

import (
	"github.com/jitsucom/jitsu/server/templates"

	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/logging"
)

func main() {
	logging.LogLevel = logging.DEBUG
	executor, err := templates.NewNodeExecutor(templates.Expression(`process.exit(0)`), nil)

	if err != nil {
		panic(err)
	}

	defer executor.Close()

	for i := 0; i < 109; i++ {
		_, err := executor.ProcessEvent(events.Event{"id": i})
		if err != nil {
			panic(err)
		}

		//if fmt.Sprint(i) != fmt.Sprint(result.(map[string]interface{})["hello"]) {
		//	logging.Fatal("%v must be %d", result, i)
		//}
	}
}
