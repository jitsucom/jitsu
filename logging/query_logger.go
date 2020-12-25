package logging

import (
	"fmt"
	"io"
	"log"
	"strings"
)

type QueryLogger struct {
	queryLogger *log.Logger
	ddlLogger   *log.Logger
	identifier  string
}

func NewQueryLogger(identifier string, ddlWriter io.Writer, queryWriter io.Writer) *QueryLogger {
	var queryLogger *log.Logger
	if queryWriter != nil {
		queryLogger = log.New(DateTimeWriterProxy{writer: queryWriter}, "", 0)
	}
	var ddlLogger *log.Logger
	if ddlWriter != nil {
		ddlLogger = log.New(DateTimeWriterProxy{writer: ddlWriter}, "", 0)
	}
	return &QueryLogger{identifier: identifier, queryLogger: queryLogger, ddlLogger: ddlLogger}
}

func (l *QueryLogger) LogDDL(query string) {
	if l.ddlLogger != nil {
		l.ddlLogger.Printf("%s [%s] %s\n", debugPrefix, l.identifier, query)
	}
}

func (l *QueryLogger) LogQuery(query string) {
	if l.queryLogger != nil {
		l.queryLogger.Printf("%s [%s] %s\n", debugPrefix, l.identifier, query)
	}
}

func (l *QueryLogger) LogQueryWithValues(query string, values []interface{}) {
	if l.queryLogger != nil {
		var stringValues []string
		for _, value := range values {
			stringValues = append(stringValues, fmt.Sprint(value))
		}
		l.queryLogger.Printf("%s [%s] %s; values: [%s]\n", debugPrefix, l.identifier, query, strings.Join(stringValues, ", "))
	}
}
