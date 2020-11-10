package storages

import (
	"errors"
	"github.com/jitsucom/eventnative/adapters"
	"github.com/jitsucom/eventnative/events"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/schema"
)

//Store files to aws s3 in batch mode
type S3 struct {
	name            string
	s3Adapter       *adapters.S3
	schemaProcessor *schema.Processor
	breakOnError    bool
}

func NewS3(name string, s3Config *adapters.S3Config, processor *schema.Processor, breakOnError bool) (*S3, error) {
	s3Adapter, err := adapters.NewS3(s3Config)
	if err != nil {
		return nil, err
	}

	s3 := &S3{
		name:            name,
		s3Adapter:       s3Adapter,
		schemaProcessor: processor,
		breakOnError:    breakOnError,
	}

	return s3, nil
}

func (s3 *S3) Consume(fact events.Fact, tokenId string) {
	logging.Errorf("[%s] S3 storage doesn't support streaming mode", s3.Name())
}

//Store file from byte payload to s3 with processing
//return rows count and err if can't store
//or rows count and nil if stored
func (s3 *S3) Store(fileName string, payload []byte) (int, error) {
	flatData, err := s3.schemaProcessor.ProcessFilePayload(fileName, payload, s3.breakOnError)
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

	return rowsCount, nil
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
	return nil
}
