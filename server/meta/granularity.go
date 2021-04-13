package meta

import (
	"fmt"
	"strings"
)

//Granularity is used for gathering statistics
type Granularity string

const (
	UNKNOWN Granularity = ""

	DAY  Granularity = "day"
	HOUR Granularity = "hour"
)

func (g Granularity) String() string {
	return string(g)
}

func GranularityFromString(value string) (Granularity, error) {
	switch strings.ToUpper(strings.TrimSpace(value)) {
	case "DAY":
		return DAY, nil
	case "HOUR":
		return HOUR, nil
	default:
		return UNKNOWN, fmt.Errorf("Unknown granularity: %s. Supported: [DAY, HOUR]", value)
	}
}
