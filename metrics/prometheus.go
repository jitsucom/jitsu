package metrics

import "strings"

var Enabled = false

func Init(enabled bool) {
	Enabled = enabled
	if Enabled {
		initEvents()
	}
}

func extractLabels(destinationName string) (projectId, destinationId string) {
	splitted := strings.Split(destinationName, ".")
	if len(splitted) > 1 {
		return splitted[0], splitted[1]
	}

	return "-", destinationName
}
