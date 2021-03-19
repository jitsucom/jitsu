package logging

import "strings"

type Level int

const (
	UNKNOWN Level = iota
	DEBUG
	INFO
	WARN
	ERROR
	FATAL
)

func (l Level) String() string {
	switch l {
	case UNKNOWN:
		return "unknown"
	case DEBUG:
		return "debug"
	case INFO:
		return "info"
	case WARN:
		return "warn"
	case ERROR:
		return "error"
	case FATAL:
		return "fatal"
	default:
		return ""
	}
}

func ToLevel(levelStr string) Level {
	switch strings.TrimSpace(strings.ToLower(levelStr)) {
	case "debug":
		return DEBUG
	case "info":
		return INFO
	case "warn":
		return WARN
	case "error":
		return ERROR
	case "fatal":
		return FATAL
	default:
		return UNKNOWN
	}
}
