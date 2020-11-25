package storages

import (
	"errors"
	"fmt"
	"github.com/jitsucom/eventnative/adapters"
	"github.com/jitsucom/eventnative/events"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/parsers"
	"github.com/jitsucom/eventnative/schema"
)

//Store files to aws s3 in batch mode
type S3 struct {
	name            string
	s3Adapter       *adapters.S3
	schemaProcessor *schema.Processor
	fallbackLogger  *events.AsyncLogger
	breakOnError    bool
}

func NewS3(name string, s3Config *adapters.S3Config, processor *schema.Processor, breakOnError bool, fallbackLoggerFactoryMethod func() *events.AsyncLogger) (*S3, error) {
	s3Adapter, err := adapters.NewS3(s3Config)
	if err != nil {
		return nil, err
	}

	s3 := &S3{
		name:            name,
		s3Adapter:       s3Adapter,
		schemaProcessor: processor,
		fallbackLogger:  fallbackLoggerFactoryMethod(),
		breakOnError:    breakOnError,
	}

	return s3, nil
}

func (s3 *S3) Consume(fact events.Fact, tokenId string) {
	logging.Errorf("[%s] S3 storage doesn't support streaming mode", s3.Name())
}

//Store call StoreWithParseFunc with parsers.ParseJson func
func (s3 *S3) Store(fileName string, payload []byte) (int, error) {
	return s3.StoreWithParseFunc(fileName, payload, parsers.ParseJson)
}

//Store file from byte payload to s3 with processing
//return rows count and err if can't store
//or rows count and nil if stored
func (s3 *S3) StoreWithParseFunc(fileName string, payload []byte, parseFunc func([]byte) (map[string]interface{}, error)) (int, error) {
	flatData, failedEvents, err := s3.schemaProcessor.ProcessFilePayload(fileName, payload, s3.breakOnError, parseFunc)
	if err != nil {
		return linesCount(payload), err
	}

	var rowsCount int
	for _, fdata := range flatData {
		rowsCount += fdata.GetPayloadLen()
	}

	for _, fdata := range flatData {
		b, rows := fdata.GetPayloadBytes(schema.JsonMarshallerInstance)
		err := s3.s3Adapter.UploadBytes(buildDataIntoFileName(fdata, rows), b)
		if err != nil {
			return rowsCount, err
		}
	}

	//send failed events to fallback only if other events have been inserted ok
	s3.Fallback(failedEvents...)

	return rowsCount, nil
}

//Fallback log event with error to fallback logger
func (s3 *S3) Fallback(failedFacts ...*events.FailedFact) {
	for _, failedFact := range failedFacts {
		s3.fallbackLogger.ConsumeAny(failedFact)
	}
}

func (s3 *S3) SyncStore(objects []map[string]interface{}) (int, error) {
	return 0, errors.New("S3 doesn't support sync store")
}

func (s3 *S3) Name() string {
	return s3.name
}

func (s3 *S3) Type() string {
	return S3Type
}

func (s3 *S3) Close() error {
	if err := s3.fallbackLogger.Close(); err != nil {
		return fmt.Errorf("[%s] Error closing fallback logger: %v", s3.Name(), err)
	}
	return nil
}
