package main

import (
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/templates"
)

func main() {
	logging.LogLevel = logging.DEBUG
	//executor, err := templates.NewNodeExecutor(templates.Expression(`return $`), nil)
	executor, err := templates.NewNodeExecutor(&templates.DestinationPlugin{
		Package: "/Users/ikulkov/Jitsu/mixpanel-destination/mixpanel-destination-0.2.3.tgz",
		ID:      "test",
		Type:    "npm",
		Config:  nil,
	}, nil)

	if err != nil {
		panic(err)
	}

	defer executor.Close()

	if err := executor.Validate(); err != nil {
		panic(err)
	}

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
