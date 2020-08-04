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

type MultipleAsyncLogger struct {
	writerPerToken map[string]io.WriteCloser
	logCh          chan tokenizedFact
}

func (m *MultipleAsyncLogger) Consume(fact Fact, token string) error {
	m.logCh <- tokenizedFact{fact: fact, token: token}
	return nil
}

func (m *MultipleAsyncLogger) Close() (resultErr error) {
	for token, writer := range m.writerPerToken {
		if err := writer.Close(); err != nil {
			multierror.Append(resultErr, fmt.Errorf("Error closing %s writer: %v", token, err))
		}
	}
	return
}

func NewMultipleAsyncLogger(writerPerToken map[string]io.WriteCloser) Consumer {
	logger := MultipleAsyncLogger{writerPerToken: writerPerToken, logCh: make(chan tokenizedFact, 20000)}

	go func() {
		for {
			tokenizedFact := <-logger.logCh
			bts, err := json.Marshal(tokenizedFact.fact)
			if err != nil {
				log.Printf("Error writing event to log file: %v", err)
				continue
			}

			buf := bytes.NewBuffer(bts)
			buf.Write([]byte("\n"))
			writer, ok := logger.writerPerToken[tokenizedFact.token]
			if !ok {
				log.Printf("Error: unable to find writer for token %s", tokenizedFact.token)
				continue
			}

			if _, err := writer.Write(buf.Bytes()); err != nil {
				log.Println(err)
			}
		}
	}()

	return &logger
}
