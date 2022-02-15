package adapters

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/server/errorj"
	"github.com/jitsucom/jitsu/server/schema"
	"strings"

	"cloud.google.com/go/storage"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/timestamp"
	"google.golang.org/api/option"
)

var ErrMalformedBQDataset = errors.New("bq_dataset must be alphanumeric (plus underscores) and must be at most 1024 characters long")

type GoogleCloudStorage struct {
	config *GoogleConfig
	client *storage.Client
	ctx    context.Context
}

type GoogleConfig struct {
	Bucket  string      `mapstructure:"gcs_bucket,omitempty" json:"gcs_bucket,omitempty" yaml:"gcs_bucket,omitempty"`
	Project string      `mapstructure:"bq_project,omitempty" json:"bq_project,omitempty" yaml:"bq_project,omitempty"`
	Dataset string      `mapstructure:"bq_dataset,omitempty" json:"bq_dataset,omitempty" yaml:"bq_dataset,omitempty"`
	KeyFile interface{} `mapstructure:"key_file,omitempty" json:"key_file,omitempty" yaml:"key_file,omitempty"`

	//will be set on validation
	credentials option.ClientOption
}

//ValidateBatchMode checks that google cloud storage is set
func (gc *GoogleConfig) ValidateBatchMode() error {
	if gc.Bucket == "" {
		return errors.New("Google cloud storage bucket(gcs_bucket) is required parameter")
	}
	return nil
}
func (gc *GoogleConfig) Validate() error {
	if gc == nil {
		return errors.New("Google config is required")
	}

	if gc.Dataset != "" {
		if len(gc.Dataset) > 1024 {
			return ErrMalformedBQDataset
		}

		//check symbols
		for _, symbol := range gc.Dataset {
			if symbol != '_' && !schema.IsLetterOrNumber(symbol) {
				return fmt.Errorf("%s: '%s'", ErrMalformedBQDataset.Error(), string(symbol))
			}
		}
	}
	switch gc.KeyFile.(type) {
	case map[string]interface{}:
		keyFileObject := gc.KeyFile.(map[string]interface{})
		if len(keyFileObject) == 0 {
			return errors.New("Google key_file is required parameter")
		}
		b, err := json.Marshal(keyFileObject)
		if err != nil {
			return fmt.Errorf("Malformed google key_file: %v", err)
		}
		gc.credentials = option.WithCredentialsJSON(b)
	case string:
		keyFile := gc.KeyFile.(string)
		if keyFile == "workload_identity" {
			return nil
		}
		if keyFile == "" {
			return errors.New("Google key file is required parameter")
		}
		if strings.Contains(keyFile, "{") {
			gc.credentials = option.WithCredentialsJSON([]byte(keyFile))
		} else {
			gc.credentials = option.WithCredentialsFile(keyFile)
		}
	default:
		return errors.New("Google key_file must be string or json object")
	}

	return nil
}

func NewGoogleCloudStorage(ctx context.Context, config *GoogleConfig) (*GoogleCloudStorage, error) {
	var client *storage.Client
	var err error
	if config.credentials == nil {
		client, err = storage.NewClient(ctx)
	} else {
		client, err = storage.NewClient(ctx, config.credentials)
	}
	if err != nil {
		return nil, fmt.Errorf("Error creating google cloud storage client: %v", err)
	}

	return &GoogleCloudStorage{client: client, config: config, ctx: ctx}, nil
}

//UploadBytes creates named file on google cloud storage with payload
func (gcs *GoogleCloudStorage) UploadBytes(fileName string, fileBytes []byte) error {
	bucket := gcs.client.Bucket(gcs.config.Bucket)
	object := bucket.Object(fileName)
	w := object.NewWriter(gcs.ctx)

	if _, err := w.Write(fileBytes); err != nil {
		return errorj.SaveOnStageError.Wrap(err, "failed to write file to google cloud storage").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Bucket:    gcs.config.Bucket,
				Statement: fmt.Sprintf("file: %s", fileName),
			})
	}

	if err := w.Close(); err != nil {
		return errorj.SaveOnStageError.Wrap(err, "failed to close google cloud writer").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Bucket:    gcs.config.Bucket,
				Statement: fmt.Sprintf("file: %s", fileName),
			})
	}

	return nil
}

//DeleteObject deletes object from google cloud storage bucket
func (gcs *GoogleCloudStorage) DeleteObject(key string) error {
	bucket := gcs.client.Bucket(gcs.config.Bucket)
	obj := bucket.Object(key)

	if err := obj.Delete(gcs.ctx); err != nil {
		return errorj.SaveOnStageError.Wrap(err, "failed to delete from google cloud").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Bucket:    gcs.config.Bucket,
				Statement: fmt.Sprintf("file: %s", key),
			})
	}

	return nil
}

//ValidateWritePermission tries to create temporary file and remove it.
//returns nil if file creation was successful.
func (gcs *GoogleCloudStorage) ValidateWritePermission() error {
	filename := fmt.Sprintf("test_%v", timestamp.NowUTC())

	if err := gcs.UploadBytes(filename, []byte{}); err != nil {
		return err
	}

	if err := gcs.DeleteObject(filename); err != nil {
		logging.Warnf("Cannot remove object %q from Google Cloud Storage: %v", filename, err)
		// Suppressing error because we need to check only write permission
		// return err
	}

	return nil
}

//Close closes gcp client and returns err if occurred
func (gcs *GoogleCloudStorage) Close() error {
	return gcs.client.Close()
}
