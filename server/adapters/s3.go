package adapters

import (
	"bytes"
	"compress/gzip"
	"errors"
	"fmt"
	"net/http"

	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/credentials"
	"github.com/aws/aws-sdk-go/aws/session"
	"github.com/aws/aws-sdk-go/service/s3"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/timestamp"
)

//S3 is a S3 adapter for uploading/deleting files
type S3 struct {
	config *S3Config
	client *s3.S3
}

//S3Config is a dto for config deserialization
type S3Config struct {
	AccessKeyID string           `mapstructure:"access_key_id" json:"access_key_id,omitempty" yaml:"access_key_id,omitempty"`
	SecretKey   string           `mapstructure:"secret_access_key" json:"secret_access_key,omitempty" yaml:"secret_access_key,omitempty"`
	Bucket      string           `mapstructure:"bucket" json:"bucket,omitempty" yaml:"bucket,omitempty"`
	Region      string           `mapstructure:"region" json:"region,omitempty" yaml:"region,omitempty"`
	Endpoint    string           `mapstructure:"endpoint" json:"endpoint,omitempty" yaml:"endpoint,omitempty"`
	Folder      string           `mapstructure:"folder" json:"folder,omitempty" yaml:"folder,omitempty"`
	Format      S3EncodingFormat `mapstructure:"format" json:"format,omitempty" yaml:"format,omitempty"`
	Compression S3Compression    `mapstructure:"compression" json:"compression,omitempty" yaml:"compression,omitempty"`
}

type S3EncodingFormat string
type S3Compression string

const (
	S3FormatFlatJSON  S3EncodingFormat = "flat_json" //flattened json objects with \n delimiter
	S3FormatJSON      S3EncodingFormat = "json"      //file with json objects with \n delimiter (not flattened)
	S3FormatCSV       S3EncodingFormat = "csv"       //flattened csv objects with \n delimiter
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

	return &S3{client: s3.New(s3Session, awsConfig), config: s3Config}, nil
}

//UploadBytes creates named file on s3 with payload
func (a *S3) UploadBytes(fileName string, fileBytes []byte) error {
	if a.config.Folder != "" {
		fileName = a.config.Folder + "/" + fileName
	}

	fileType := http.DetectContentType(fileBytes)
	params := &s3.PutObjectInput{
		Bucket:      aws.String(a.config.Bucket),
		ContentType: aws.String(fileType),
	}

	if a.config.Compression != "" {
		var err error
		fileName += ".gz"
		fileBytes, err = a.compress(fileBytes)
		if err != nil {
			return fmt.Errorf("Error compressing file %v", err)
		}
		params.ContentEncoding = aws.String(string(a.config.Compression))
	}

	params.Key = aws.String(fileName)
	params.Body = bytes.NewReader(fileBytes)
	_, err := a.client.PutObject(params)
	if err != nil {
		return fmt.Errorf("Error uploading file to s3 %v", err)
	}
	return nil
}

func (a *S3) compress(b []byte) ([]byte, error) {
	buf := new(bytes.Buffer)
	w := gzip.NewWriter(buf)
	defer w.Close()
	if _, err := w.Write(b); err != nil {
		return nil, err
	}
	if err := w.Flush(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

//DeleteObject deletes object from s3 bucket by key
func (a *S3) DeleteObject(key string) error {
	if a.config.Folder != "" {
		key = a.config.Folder + "/" + key
	}
	input := &s3.DeleteObjectInput{Bucket: &a.config.Bucket, Key: &key}
	output, err := a.client.DeleteObject(input)
	if err != nil {
		return fmt.Errorf("Error deleting file %s from s3 %v", key, err)
	}

	if output != nil && output.DeleteMarker != nil && !*(output.DeleteMarker) {
		return fmt.Errorf("Key %s wasn't deleted from s3", key)
	}

	return nil
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
	return nil
}
