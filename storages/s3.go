package storages

import (
	"github.com/ksensehq/eventnative/adapters"
	"github.com/ksensehq/eventnative/schema"
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

//Store file from byte payload to s3 with processing
func (s3 *S3) Store(fileName string, payload []byte) error {
	flatData, err := s3.schemaProcessor.ProcessFilePayload(fileName, payload, s3.breakOnError)
	if err != nil {
		return err
	}

	for _, fdata := range flatData {
		err := s3.s3Adapter.UploadBytes(fdata.FileName+tableFileKeyDelimiter+fdata.DataSchema.Name, fdata.GetPayloadBytes(schema.JsonMarshallerInstance))
		if err != nil {
			return err
		}
	}

	return nil
}

func (s3 *S3) Name() string {
	return s3.name
}

func (s3 *S3) Type() string {
	return "S3"
}

func (s3 *S3) Close() error {
	return nil
}
