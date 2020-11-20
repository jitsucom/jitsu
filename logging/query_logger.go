package logging

import (
	"fmt"
	"log"
	"os"
	"strings"
)

type QueryLogger struct {
	enabled bool
	logger  *log.Logger
}

func NewQueryLogger(filePath string) *QueryLogger {
	var logger *log.Logger
	if filePath != "" {
		f, err := os.OpenFile("text.log",
			os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
		if err != nil {
			log.Println(err)
		}
		logger = log.New(DateTimeWriterProxy{writer: f}, "query", 0)
	}
	return &QueryLogger{enabled: true, logger: logger}
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
