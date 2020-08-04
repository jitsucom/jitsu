package adapters

import (
	"bytes"
	"errors"
	"fmt"
	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/credentials"
	"github.com/aws/aws-sdk-go/aws/session"
	"github.com/aws/aws-sdk-go/service/s3"
	"net/http"
)

type AwsS3 struct {
	config *S3Config
	client *s3.S3
}

type S3Config struct {
	AccessKeyID string `mapstructure:"access_key_id"`
	SecretKey   string `mapstructure:"secret_access_key"`
	Bucket      string `mapstructure:"bucket"`
	Region      string `mapstructure:"region"`
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

func NewAwsS3(s3Config *S3Config) (*AwsS3, error) {
	awsConfig := aws.NewConfig().
		WithCredentials(credentials.NewStaticCredentials(s3Config.AccessKeyID, s3Config.SecretKey, "")).
		WithRegion(s3Config.Region)
	s3Session := session.Must(session.NewSession())

	return &AwsS3{client: s3.New(s3Session, awsConfig), config: s3Config}, nil
}

func (a *AwsS3) UploadBytes(fileName string, fileBytes []byte) error {
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

func (a *AwsS3) ListBucket() ([]string, error) {
	input := &s3.ListObjectsV2Input{Bucket: &a.config.Bucket}
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

func (a *AwsS3) DeleteObject(key string) error {
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
