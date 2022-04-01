package adapters

import (
	"bytes"
	"compress/gzip"
	"errors"
	"fmt"
	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/credentials"
	"github.com/aws/aws-sdk-go/aws/session"
	"github.com/aws/aws-sdk-go/service/s3"
	"github.com/jitsucom/jitsu/server/errorj"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/timestamp"
	"go.uber.org/atomic"
	"net/http"
)

//S3 is a S3 adapter for uploading/deleting files
type S3 struct {
	config *S3Config
	client *s3.S3

	closed *atomic.Bool
}

//S3Config is a dto for config deserialization
type S3Config struct {
	AccessKeyID string           `mapstructure:"access_key_id,omitempty" json:"access_key_id,omitempty" yaml:"access_key_id,omitempty"`
	SecretKey   string           `mapstructure:"secret_access_key,omitempty" json:"secret_access_key,omitempty" yaml:"secret_access_key,omitempty"`
	Bucket      string           `mapstructure:"bucket,omitempty" json:"bucket,omitempty" yaml:"bucket,omitempty"`
	Region      string           `mapstructure:"region,omitempty" json:"region,omitempty" yaml:"region,omitempty"`
	Endpoint    string           `mapstructure:"endpoint,omitempty" json:"endpoint,omitempty" yaml:"endpoint,omitempty"`
	Folder      string           `mapstructure:"folder,omitempty" json:"folder,omitempty" yaml:"folder,omitempty"`
	Format      S3EncodingFormat `mapstructure:"format,omitempty" json:"format,omitempty" yaml:"format,omitempty"`
	Compression S3Compression    `mapstructure:"compression,omitempty" json:"compression,omitempty" yaml:"compression,omitempty"`
}

type S3EncodingFormat string
type S3Compression string

const (
	S3FormatFlatJSON  S3EncodingFormat = "flat_json" //flattened json objects with \n delimiter
	S3FormatJSON      S3EncodingFormat = "json"      //file with json objects with \n delimiter (not flattened)
	S3FormatCSV       S3EncodingFormat = "csv"       //flattened csv objects with \n delimiter
	S3FormatParquet   S3EncodingFormat = "parquet"   //flattened objects which are marshalled in apache parquet file
	S3CompressionGZIP S3Compression    = "gzip"      //gzip compression
)

//Validate returns err if invalid
func (s3c *S3Config) Validate() error {
	if s3c == nil {
		return errors.New("S3 config is required")
	}
	if s3c.AccessKeyID == "" {
		return errors.New("S3 access_key_id is required parameter")
	}
	if s3c.SecretKey == "" {
		return errors.New("S3 secret_access_key is required parameter")
	}
	if s3c.Bucket == "" {
		return errors.New("S3 bucket is required parameter")
	}
	if s3c.Region == "" {
		return errors.New("S3 region is required parameter")
	}
	return nil
}

//NewS3 returns configured S3 adapter
func NewS3(s3Config *S3Config) (*S3, error) {
	if err := s3Config.Validate(); err != nil {
		return nil, err
	}

	awsConfig := aws.NewConfig().
		WithCredentials(credentials.NewStaticCredentials(s3Config.AccessKeyID, s3Config.SecretKey, "")).
		WithRegion(s3Config.Region)
	if s3Config.Endpoint != "" {
		awsConfig.WithEndpoint(s3Config.Endpoint)
	}
	if s3Config.Format == "" {
		s3Config.Format = S3FormatFlatJSON
	}
	s3Session := session.Must(session.NewSession())

	return &S3{client: s3.New(s3Session, awsConfig), config: s3Config, closed: atomic.NewBool(false)}, nil
}

func (a *S3) Format() S3EncodingFormat {
	return a.config.Format
}

func (a *S3) Compression() S3Compression {
	return a.config.Compression
}

//UploadBytes creates named file on s3 with payload
func (a *S3) UploadBytes(fileName string, fileBytes []byte) error {
	if a.closed.Load() {
		return fmt.Errorf("attempt to use closed S3 instance")
	}
	if a.config.Folder != "" {
		fileName = a.config.Folder + "/" + fileName
	}

	params := &s3.PutObjectInput{
		Bucket: aws.String(a.config.Bucket),
	}

	var fileType string
	if a.config.Compression == S3CompressionGZIP {
		var err error
		fileName = fileNameGZIP(fileName)
		buf, err := a.compressGZIP(fileBytes)
		if err != nil {
			return fmt.Errorf("Error compressing file %v", err)
		}
		fileBytes = buf.Bytes()
		fileType = "application/gzip"
	} else {
		fileType = http.DetectContentType(fileBytes)
	}

	params.ContentType = aws.String(fileType)
	params.Key = aws.String(fileName)
	params.Body = bytes.NewReader(fileBytes)
	if _, err := a.client.PutObject(params); err != nil {
		return errorj.SaveOnStageError.Wrap(err, "failed to write file to s3").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Bucket:    a.config.Bucket,
				Statement: fmt.Sprintf("file: %s", fileName),
			})
	}
	return nil
}

func (a *S3) compressGZIP(b []byte) (*bytes.Buffer, error) {
	buf := new(bytes.Buffer)
	w := gzip.NewWriter(buf)
	defer w.Close()
	if _, err := w.Write(b); err != nil {
		return nil, err
	}
	return buf, nil
}

//DeleteObject deletes object from s3 bucket by key
func (a *S3) DeleteObject(key string) error {
	if a.closed.Load() {
		return fmt.Errorf("attempt to use closed S3 instance")
	}
	if a.config.Folder != "" {
		key = a.config.Folder + "/" + key
	}
	if a.config.Compression == S3CompressionGZIP {
		key = fileNameGZIP(key)
	}
	input := &s3.DeleteObjectInput{Bucket: &a.config.Bucket, Key: &key}
	output, err := a.client.DeleteObject(input)
	if err != nil {
		return errorj.SaveOnStageError.Wrap(err, "failed to delete from s3").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Bucket:    a.config.Bucket,
				Statement: fmt.Sprintf("file: %s", key),
			})
	}

	if output != nil && output.DeleteMarker != nil && !*(output.DeleteMarker) {
		return errorj.SaveOnStageError.Wrap(err, "file hasn't been deleted from s3").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Bucket:    a.config.Bucket,
				Statement: fmt.Sprintf("file: %s", key),
			})
	}

	return nil
}

func fileNameGZIP(fileName string) string {
	return fileName + ".gz"
}

//ValidateWritePermission tries to create temporary file and remove it.
//returns nil if file creation was successful.
func (a *S3) ValidateWritePermission() error {
	filename := fmt.Sprintf("test_%v", timestamp.NowUTC())

	if err := a.UploadBytes(filename, []byte{}); err != nil {
		return err
	}

	if err := a.DeleteObject(filename); err != nil {
		logging.Warnf("Cannot remove object %q from S3: %v", filename, err)
		// Suppressing error because we need to check only write permission
		// return err
	}

	return nil
}

//Close returns nil
func (a *S3) Close() error {
	a.closed.Store(true)
	return nil
}
