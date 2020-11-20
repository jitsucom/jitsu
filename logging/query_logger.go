package logging

import (
	"fmt"
	"log"
	"strings"
)

type QueryLogger struct {
	enabled bool
	logger  *log.Logger
}

func NewQueryLogger(enabled bool, config *Config) (*QueryLogger, error) {
	if !enabled {
		return &QueryLogger{enabled: false}, nil
	}
	var logger *log.Logger
	if config != nil {
		writer, err := NewWriter(*config)
		if err != nil {
			return nil, err
		}
		logger = log.New(DateTimeWriterProxy{writer: writer}, "", 0)
	}
	return &QueryLogger{enabled: true, logger: logger}, nil
}

func (l *QueryLogger) Log(destinationId string, query string) {
	if !l.enabled {
		return
	}
	if l.logger != nil {
		l.logger.Printf("[%s] %s\n", destinationId, query)
	} else {
		Debugf("[%s] %s", destinationId, query)
	}
}

func (l *QueryLogger) LogWithValues(destinationId string, query string, values []interface{}) {
	if !l.enabled {
		return
	}
	var stringValues []string
	for _, value := range values {
		stringValues = append(stringValues, fmt.Sprint(value))
	}
	if l.logger != nil {
		l.logger.Printf("[%s] %s values: [%s]\n", destinationId, query, strings.Join(stringValues, ", "))
	} else {
		Debugf("[%s] %s values: [%s]", destinationId, query, strings.Join(stringValues, ", "))
	}
}

func (l *QueryLogger) Close() {
	//l.logger.
}
