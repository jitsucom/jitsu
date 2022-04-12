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
		Config: map[string]interface{}{
			"anonymous_users_enabled": false,
			"api_secret":              "e6467395e5cc7fe5d3661c7f881a2d94",
			"project_id":              "2129077",
			"token":                   "f50e313c6414265c665c5f3853135c51",
			"users_enabled":           false,
		},
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
