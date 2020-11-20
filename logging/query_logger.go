package logging

import (
	"log"
	"os"
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

func (l *QueryLogger) Close() {
	//l.logger.
}
