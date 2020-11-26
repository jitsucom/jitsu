package logging

import (
	"fmt"
	"io"
	"log"
	"strings"
)

type QueryLogger struct {
	logger        *log.Logger
	destinationId string
}

func NewQueryLogger(destinationId string, writer io.Writer) *QueryLogger {
	var logger *log.Logger
	if writer != nil {
		logger = log.New(DateTimeWriterProxy{writer: writer}, "", 0)
	}
	return &QueryLogger{destinationId: destinationId, logger: logger}
}

func (l *QueryLogger) Log(query string) {
	if l.logger != nil {
		l.logger.Printf("%s [%s] %s\n", debugPrefix, l.destinationId, query)
	}
}

func (l *QueryLogger) LogWithValues(query string, values []interface{}) {
	if l.logger != nil {
		var stringValues []string
		for _, value := range values {
			stringValues = append(stringValues, fmt.Sprint(value))
		}
		l.logger.Printf("%s [%s] %s; values: [%s]\n", debugPrefix, l.destinationId, query, strings.Join(stringValues, ", "))
	}
}
