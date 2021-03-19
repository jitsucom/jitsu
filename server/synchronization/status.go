package synchronization

import (
	"fmt"
	"strings"
)

type Status string

const (
	SCHEDULED Status = "SCHEDULED"
	RUNNING   Status = "RUNNING"
	FAILED    Status = "FAILED"
	SUCCESS   Status = "SUCCESS"
)

func (s Status) String() string {
	return string(s)
}

func StatusFromString(value string) (Status, error) {
	switch strings.ToUpper(strings.TrimSpace(value)) {
	case "SCHEDULED":
		return SCHEDULED, nil
	case "FAILED":
		return FAILED, nil
	case "SUCCESS":
		return SUCCESS, nil
	case "RUNNING":
		return RUNNING, nil
	default:
		return "", fmt.Errorf("Unknown status: %s. Supported: [SCHEDULED, FAILED, SUCCESS, RUNNING]", value)
	}
}
