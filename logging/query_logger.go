package logging

import (
	"fmt"
	"io"
	"log"
	"strings"
)

type QueryLogger struct {
	logger     *log.Logger
	identifier string
}

func NewQueryLogger(identifier string, writer io.Writer) *QueryLogger {
	var logger *log.Logger
	if writer != nil {
		logger = log.New(DateTimeWriterProxy{writer: writer}, "", 0)
	}
	return &QueryLogger{identifier: identifier, logger: logger}
}

func (l *QueryLogger) Log(query string) {
	if l.logger != nil {
		l.logger.Printf("%s [%s] %s\n", debugPrefix, l.identifier, query)
	}
}

func (l *QueryLogger) LogWithValues(query string, values []interface{}) {
	if l.logger != nil {
		var stringValues []string
		for _, value := range values {
			stringValues = append(stringValues, fmt.Sprint(value))
		}
		l.logger.Printf("%s [%s] %s; values: [%s]\n", debugPrefix, l.identifier, query, strings.Join(stringValues, ", "))
	}
}
