package storages

import (
	"github.com/ksensehq/eventnative/adapters"
	"github.com/ksensehq/eventnative/schema"
)

//Store files to aws s3 in batch mode
type AwsS3 struct {
	s3Adapter       *adapters.AwsS3
	schemaProcessor *schema.Processor
	breakOnError    bool
}

func NewAwsS3(s3Config *adapters.S3Config, processor *schema.Processor, breakOnError bool) (*AwsS3, error) {
	s3Adapter, err := adapters.NewAwsS3(s3Config)
	if err != nil {
		return nil, err
	}

	ar := &AwsS3{
		s3Adapter:       s3Adapter,
		schemaProcessor: processor,
		breakOnError:    breakOnError,
	}

	return ar, nil
}

//Store file from byte payload to s3 with processing
func (s3 *AwsS3) Store(fileName string, payload []byte) error {
	flatData, err := s3.schemaProcessor.ProcessFilePayloadIntoBytes(fileName, payload, s3.breakOnError)
	if err != nil {
		return err
	}

	for _, fdata := range flatData {
		err := s3.s3Adapter.UploadBytes(fdata.FileName+tableFileKeyDelimiter+fdata.DataSchema.Name, fdata.Payload.Bytes())
		if err != nil {
			return err
		}
	}

	return nil
}

func (s3 AwsS3) Name() string {
	return "S3"
}

func (s3 AwsS3) Close() error {
	return nil
}
