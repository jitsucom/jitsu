package adapters

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/http"

	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/credentials"
	"github.com/aws/aws-sdk-go/aws/session"
	"github.com/aws/aws-sdk-go/service/s3"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/timestamp"
)

type S3 struct {
	config *S3Config
	client *s3.S3
}

type S3Config struct {
	AccessKeyID string `mapstructure:"access_key_id" json:"access_key_id,omitempty" yaml:"access_key_id,omitempty"`
	SecretKey   string `mapstructure:"secret_access_key" json:"secret_access_key,omitempty" yaml:"secret_access_key,omitempty"`
	Bucket      string `mapstructure:"bucket" json:"bucket,omitempty" yaml:"bucket,omitempty"`
	Region      string `mapstructure:"region" json:"region,omitempty" yaml:"region,omitempty"`
	Endpoint    string `mapstructure:"endpoint" json:"endpoint,omitempty" yaml:"endpoint,omitempty"`
	Folder      string `mapstructure:"folder" json:"folder,omitempty" yaml:"folder,omitempty"`
}

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
	s3Session := session.Must(session.NewSession())

	return &S3{client: s3.New(s3Session, awsConfig), config: s3Config}, nil
}

//Create named file on s3 with payload
func (a *S3) UploadBytes(fileName string, fileBytes []byte) error {
	if a.config.Folder != "" {
		fileName = a.config.Folder + "/" + fileName
	}
	fileType := http.DetectContentType(fileBytes)
	params := &s3.PutObjectInput{
		Bucket:      aws.String(a.config.Bucket),
		Key:         aws.String(fileName),
		Body:        bytes.NewReader(fileBytes),
		ContentType: aws.String(fileType),
	}
	_, err := a.client.PutObject(params)
	if err != nil {
		return fmt.Errorf("Error uploading file to s3 %v", err)
	}
	return nil
}

//Return s3 bucket file keys filtered by file name prefix
//Deprecated
func (a *S3) ListBucket(fileNamePrefix string) ([]string, error) {
	prefix := fileNamePrefix
	if a.config.Folder != "" {
		prefix = a.config.Folder + "/" + fileNamePrefix
	}
	input := &s3.ListObjectsV2Input{Bucket: &a.config.Bucket, Prefix: &prefix}
	var files []string
	for {
		output, err := a.client.ListObjectsV2(input)
		if err != nil {
			return nil, err
		}
		for _, f := range output.Contents {
			files = append(files, *f.Key)
		}
		if *output.IsTruncated == false {
			break
		} else {
			input.ContinuationToken = output.NextContinuationToken
		}
	}

	return files, nil
}

//Return s3 file by key
//Deprecated
func (a *S3) GetObject(key string) ([]byte, error) {
	if a.config.Folder != "" {
		key = a.config.Folder + "/" + key
	}
	input := &s3.GetObjectInput{Bucket: &a.config.Bucket, Key: &key}
	result, err := a.client.GetObject(input)
	if err != nil {
		return nil, err
	}

	defer result.Body.Close()

	buf := bytes.NewBuffer(nil)
	if _, err := io.Copy(buf, result.Body); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

//Delete object from s3 bucket by key
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

// Function tries to create temporary file and remove it.
// Returns OK if file creation was successfull.
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

func (a *S3) Close() error {
	return nil
}
