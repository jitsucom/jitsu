package synchronization

import (
	"fmt"
	"math"
	"strings"
	"time"
)

type Priority int64

const (
	UNKNOWN Priority = -1

	LOW  Priority = 100
	HIGH Priority = 200
	NOW  Priority = 300
)

//GetValue return Priority value based on time (created_at)
//task_priority * 10^12 - created_at_unix
func (p Priority) GetValue(t time.Time) int64 {
	return int64(p)*int64(math.Pow10(12)) - t.UTC().Unix()
}

func (p Priority) String() string {
	switch p {
	case LOW:
		return "LOW"
	case HIGH:
		return "HIGH"
	case NOW:
		return "NOW"
	default:
		return "UNKNOWN"
	}
}

func PriorityFromString(value string) (Priority, error) {
	switch strings.ToUpper(strings.TrimSpace(value)) {
	case "LOW":
		return LOW, nil
	case "HIGH":
		return HIGH, nil
	case "NOW":
		return NOW, nil
	default:
		return UNKNOWN, fmt.Errorf("Unknown priority: %s. Supported: [LOW, HIGH, NOW]", value)
	}
}
