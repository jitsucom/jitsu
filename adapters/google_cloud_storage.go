package adapters

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/ioutil"
	"strings"

	"cloud.google.com/go/storage"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/timestamp"
	"google.golang.org/api/iterator"
	"google.golang.org/api/option"
)

type GoogleCloudStorage struct {
	config *GoogleConfig
	client *storage.Client
	ctx    context.Context
}

type GoogleConfig struct {
	Bucket  string      `mapstructure:"gcs_bucket" json:"gcs_bucket,omitempty" yaml:"gcs_bucket,omitempty"`
	Project string      `mapstructure:"bq_project" json:"bq_project,omitempty" yaml:"bq_project,omitempty"`
	Dataset string      `mapstructure:"bq_dataset" json:"bq_dataset,omitempty" yaml:"bq_dataset,omitempty"`
	KeyFile interface{} `mapstructure:"key_file" json:"key_file,omitempty" yaml:"key_file,omitempty"`

	//will be set on validation
	credentials option.ClientOption
}

func (gc *GoogleConfig) Validate(streamMode bool) error {
	if gc == nil {
		return errors.New("Google config is required")
	}
	//batch mode works via google cloud storage
	if !streamMode && gc.Bucket == "" {
		return errors.New("Google cloud storage bucket(gcs_bucket) is required parameter")
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
	client, err := storage.NewClient(ctx, config.credentials)
	if err != nil {
		return nil, fmt.Errorf("Error creating google cloud storage client: %v", err)
	}

	return &GoogleCloudStorage{client: client, config: config, ctx: ctx}, nil
}

//Create named file on google cloud storage with payload
func (gcs *GoogleCloudStorage) UploadBytes(fileName string, fileBytes []byte) error {
	bucket := gcs.client.Bucket(gcs.config.Bucket)
	object := bucket.Object(fileName)
	w := object.NewWriter(gcs.ctx)

	if _, err := w.Write(fileBytes); err != nil {
		return fmt.Errorf("Error writing file to google cloud storage: %v", err)
	}

	if err := w.Close(); err != nil {
		return fmt.Errorf("Error closing file writer to google cloud storage: %v", err)
	}

	return nil
}

//Return google cloud storage bucket file names filtered by prefix
func (gcs *GoogleCloudStorage) ListBucket(prefix string) ([]string, error) {
	bucket := gcs.client.Bucket(gcs.config.Bucket)
	it := bucket.Objects(gcs.ctx, &storage.Query{Prefix: prefix})
	var files []string
	for {
		attrs, err := it.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("Error listing google cloud storage bucket %s: %v", gcs.config.Bucket, err)
		}
		files = append(files, attrs.Name)
	}

	return files, nil
}

//Delete object from google cloud storage bucket
func (gcs *GoogleCloudStorage) DeleteObject(key string) error {
	bucket := gcs.client.Bucket(gcs.config.Bucket)
	obj := bucket.Object(key)

	if err := obj.Delete(gcs.ctx); err != nil {
		return fmt.Errorf("Error deleting file %s from google cloud storage %v", key, err)
	}

	return nil
}

//Get object from google cloud storage bucket
func (gcs *GoogleCloudStorage) GetObject(key string) ([]byte, error) {
	bucket := gcs.client.Bucket(gcs.config.Bucket)
	obj := bucket.Object(key)

	r, err := obj.NewReader(gcs.ctx)
	if err != nil {
		return nil, err
	}
	defer r.Close()

	return ioutil.ReadAll(r)
}

// Function tries to create temporary file and remove it.
// Returns OK if file creation was successfull.
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

func (gcs *GoogleCloudStorage) Close() error {
	return gcs.client.Close()
}
