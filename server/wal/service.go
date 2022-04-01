package wal

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"github.com/jitsucom/jitsu/server/appstatus"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/logevents"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/multiplexing"
	"github.com/jitsucom/jitsu/server/safego"
	"go.uber.org/atomic"
	"io"
	"io/ioutil"
	"os"
	"path"
	"path/filepath"
	"time"
)

const (
	walFileMask = "write-ahead-log*-20*.log"
)

//Record is a dto for saving serialized input events with token and processor type
type Record struct {
	Events         []events.Event         `json:"events,omitempty"`
	Token          string                 `json:"token,omitempty"`
	ProcessorType  string                 `json:"processor_type,omitempty"`
	RequestContext *events.RequestContext `json:"request_context,omitempty"`
}

//Service is a write-ahead-log service that collects events
//when the application is in idle mode (see appstatus.AppStatus) and stores them into log file
//when the application isn't in idle mode - process log file and store events
type Service struct {
	walFileMask string

	logger              logging.ObjectLogger
	multiplexingService *multiplexing.Service
	processorHolder     *events.ProcessorHolder

	closed *atomic.Bool
}

//NewService returns configured Service and starts goroutine for handling write-ahead-log
func NewService(logEventPath string, logger logging.ObjectLogger, multiplexingService *multiplexing.Service, processorHolder *events.ProcessorHolder) *Service {
	s := &Service{
		walFileMask:         path.Join(logEventPath, logevents.IncomingDir, walFileMask),
		logger:              logger,
		multiplexingService: multiplexingService,
		processorHolder:     processorHolder,
		closed:              atomic.NewBool(false),
	}

	s.start()
	return s
}

//Run goroutine after 5 minute sleep for:
//1. read from write-ahead-log if not idle
//2. pass events into multiplexing.Service
func (s *Service) start() {
	safego.RunWithRestart(func() {
		time.Sleep(5 * time.Minute)
		for {
			if s.closed.Load() {
				break
			}

			if appstatus.Instance.Idle.Load() {
				time.Sleep(5 * time.Second)
				continue
			}

			files, err := filepath.Glob(s.walFileMask)
			if err != nil {
				logging.SystemErrorf("Error finding wal files by %s mask: %v", s.walFileMask, err)
				continue
			}

			for _, filePath := range files {
				err := s.handleFile(filePath)
				if err != nil {
					logging.Error(err)
					continue
				}

				if err = os.Remove(filePath); err != nil {
					logging.SystemErrorf("Error removing wal file [%s] after processing: %v", filePath, err)
				}
			}

			time.Sleep(time.Minute)
		}
	})
}

//Consume passes record into logger
func (s *Service) Consume(events []events.Event, reqContext *events.RequestContext, token, processorType string) {
	s.logger.ConsumeAny(&Record{
		Events:         events,
		Token:          token,
		ProcessorType:  processorType,
		RequestContext: reqContext,
	})
}

func (s *Service) handleFile(filePath string) error {
	b, err := ioutil.ReadFile(filePath)
	if err != nil {
		return fmt.Errorf("Error reading wal file [%s]: %v", filePath, err)
	}

	if len(b) == 0 {
		return nil
	}

	var records []Record
	input := bytes.NewBuffer(b)
	reader := bufio.NewReaderSize(input, 64*1024)
	line, readErr := reader.ReadBytes('\n')

	for readErr == nil {
		record := Record{}
		if err := json.Unmarshal(line, &record); err != nil {
			return fmt.Errorf("Error parsing JSON string [%s] into Record: %v", string(line), err)
		}

		records = append(records, record)

		line, readErr = reader.ReadBytes('\n')
		if readErr != nil && readErr != io.EOF {
			return readErr
		}
	}

	for _, record := range records {
		processor := s.processorHolder.GetByType(record.ProcessorType)
		_, err := s.multiplexingService.AcceptRequest(processor, record.RequestContext, record.Token, record.Events)
		if err != nil {
			//ELOST
			reqBody, _ := json.Marshal(record)
			logging.Warnf("%v. Event from wal: %s", err, string(reqBody))
		}
	}

	return nil
}

//Close closes goroutine and logger
func (s *Service) Close() error {
	s.closed.Store(true)
	if err := s.logger.Close(); err != nil {
		return fmt.Errorf("error closing write-ahead-log: %v", err)
	}

	return nil
}
