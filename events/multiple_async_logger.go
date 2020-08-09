package events

import (
	"bytes"
	"encoding/json"
	"fmt"
	"github.com/hashicorp/go-multierror"
	"io"
	"log"
)

type tokenizedFact struct {
	fact  Fact
	token string
}

//Logger that's is handling multiple log files: one per token(api_key)
type MultipleAsyncLogger struct {
	writerPerToken     map[string]io.WriteCloser
	logCh              chan tokenizedFact
	showInGlobalLogger bool
}

//Put event fact to channel
func (m *MultipleAsyncLogger) Consume(fact Fact, token string) error {
	m.logCh <- tokenizedFact{fact: fact, token: token}
	return nil
}

func (m *MultipleAsyncLogger) Close() (resultErr error) {
	for token, writer := range m.writerPerToken {
		if err := writer.Close(); err != nil {
			resultErr = multierror.Append(resultErr, fmt.Errorf("Error closing %s writer: %v", token, err))
		}
	}
	return
}

//Create MultipleAsyncLogger and run goroutine that's read from channel
//and write to file according to token
func NewMultipleAsyncLogger(writerPerToken map[string]io.WriteCloser, showInGlobalLogger bool) Consumer {
	logger := MultipleAsyncLogger{writerPerToken: writerPerToken, logCh: make(chan tokenizedFact, 20000), showInGlobalLogger: showInGlobalLogger}

	go func() {
		for {
			tokenizedFact := <-logger.logCh
			bts, err := json.Marshal(&tokenizedFact.fact)
			if err != nil {
				log.Printf("Error writing event to log file: %v", err)
				continue
			}

			buf := bytes.NewBuffer(bts)
			buf.Write([]byte("\n"))
			writer, ok := logger.writerPerToken[tokenizedFact.token]
			if !ok {
				log.Printf("Error marshaling json event for token %s: %v", tokenizedFact.token, err)
				continue
			}

			if logger.showInGlobalLogger {
				prettyJsonBytes, _ := json.MarshalIndent(&tokenizedFact.fact, " ", "\t")
				log.Println(string(prettyJsonBytes))
			}

			if _, err := writer.Write(buf.Bytes()); err != nil {
				log.Println(err)
			}
		}
	}()

	return &logger
}
