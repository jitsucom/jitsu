package adapters

import (
	"cloud.google.com/go/storage"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"google.golang.org/api/iterator"
	"google.golang.org/api/option"
	"io/ioutil"
	"strings"
)

type GoogleCloudStorage struct {
	config *GoogleConfig
	client *storage.Client
	ctx    context.Context
}

type GoogleConfig struct {
	Bucket  string      `mapstructure:"gcs_bucket"`
	Project string      `mapstructure:"bq_project"`
	Dataset string      `mapstructure:"bq_dataset"`
	KeyFile interface{} `mapstructure:"key_file"`

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

func (gcs *GoogleCloudStorage) Close() error {
	if err := gcs.client.Close(); err != nil {
		return fmt.Errorf("Error closing google cloud storage client: %v", err)
	}

	return nil
}
