package adapters

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jitsucom/jitsu/server/errorj"
	"github.com/jitsucom/jitsu/server/schema"
	"go.uber.org/atomic"

	"cloud.google.com/go/storage"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/timestamp"
	"google.golang.org/api/option"
)

var ErrMalformedBQDataset = errors.New("bq_dataset must be alphanumeric (plus underscores) and must be at most 1024 characters long")

type GoogleConfig struct {
	Bucket     string      `mapstructure:"gcs_bucket,omitempty" json:"gcs_bucket,omitempty" yaml:"gcs_bucket,omitempty"`
	Project    string      `mapstructure:"bq_project,omitempty" json:"bq_project,omitempty" yaml:"bq_project,omitempty"`
	Dataset    string      `mapstructure:"bq_dataset,omitempty" json:"bq_dataset,omitempty" yaml:"bq_dataset,omitempty"`
	KeyFile    interface{} `mapstructure:"key_file,omitempty" json:"key_file,omitempty" yaml:"key_file,omitempty"`
	FileConfig `mapstructure:",squash" yaml:"-,inline"`

	//will be set on validation
	credentials option.ClientOption
}

// ValidateBatchMode checks that google cloud storage is set
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

type GoogleCloudStorage struct {
	config *GoogleConfig
	client *storage.Client
	ctx    context.Context

	closed *atomic.Bool
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

	if config.Format == "" {
		config.Format = FileFormatJSON
	}

	return &GoogleCloudStorage{client: client, config: config, ctx: ctx, closed: atomic.NewBool(false)}, nil
}

func (gcs *GoogleCloudStorage) Format() FileEncodingFormat {
	return gcs.config.Format
}

func (gcs *GoogleCloudStorage) Compression() FileCompression {
	return gcs.config.Compression
}

// UploadBytes creates named file on google cloud storage with payload
func (gcs *GoogleCloudStorage) UploadBytes(fileName string, fileBytes []byte) (err error) {
	//panic handler
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("panic while uploading file: %s to GCC project: %s bucket: %s dataset: %s : %v", fileName, gcs.config.Project, gcs.config.Bucket, gcs.config.Dataset, r)
			logging.SystemErrorf(err.Error())
		}
	}()
	if gcs.closed.Load() {
		return fmt.Errorf("attempt to use closed GoogleCloudStorage instance")
	}
	if err := gcs.config.PrepareFile(&fileName, &fileBytes); err != nil {
		return err
	}

	bucket := gcs.client.Bucket(gcs.config.Bucket)
	object := bucket.Object(fileName)
	ctx, cancelFn := context.WithTimeout(gcs.ctx, time.Minute*5)
	if cancelFn != nil {
		defer cancelFn()
	}
	w := object.NewWriter(ctx)

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

// DeleteObject deletes object from google cloud storage bucket
func (gcs *GoogleCloudStorage) DeleteObject(key string) (err error) {
	//panic handler
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("panic while deleting file: %s to GCC project: %s bucket: %s dataset: %s : %v", key, gcs.config.Project, gcs.config.Bucket, gcs.config.Dataset, r)
			logging.SystemErrorf(err.Error())
		}
	}()
	if gcs.closed.Load() {
		return fmt.Errorf("attempt to use closed GoogleCloudStorage instance")
	}
	bucket := gcs.client.Bucket(gcs.config.Bucket)
	_ = gcs.config.PrepareFile(&key, nil)
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

// ValidateWritePermission tries to create temporary file and remove it.
// returns nil if file creation was successful.
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

// Close closes gcp client and returns err if occurred
func (gcs *GoogleCloudStorage) Close() error {
	gcs.closed.Store(true)
	return gcs.client.Close()
}
