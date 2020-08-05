package adapters

import (
	"cloud.google.com/go/storage"
	"context"
	"errors"
	"fmt"
	"google.golang.org/api/iterator"
)

type GoogleCloudStorage struct {
	config *GoogleConfig
	client *storage.Client
	ctx    context.Context
}

type GoogleConfig struct {
	Bucket  string `mapstructure:"gcs_bucket"`
	Project string `mapstructure:"bq_project"`
	Dataset string `mapstructure:"bq_dataset"`
	KeyFile string `mapstructure:"key_file"`
}

func (gc *GoogleConfig) Validate() error {
	if gc == nil {
		return errors.New("Google config is required")
	}
	if gc.Bucket == "" {
		return errors.New("Google cloud storage bucket(gcs_bucket) is required parameter")
	}
	if gc.KeyFile == "" {
		return errors.New("Google key file is required parameter")
	}
	if gc.Project == "" {
		return errors.New("BigQuery project(bq_project) is required parameter")
	}

	return nil
}

func NewGoogleCloudStorage(ctx context.Context, config *GoogleConfig) (*GoogleCloudStorage, error) {
	credentials := extractCredentials(config)
	client, err := storage.NewClient(ctx, credentials)
	if err != nil {
		return nil, fmt.Errorf("Error creating google cloud storage client: %v", err)
	}

	return &GoogleCloudStorage{client: client, config: config, ctx: ctx}, nil
}

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

func (gcs *GoogleCloudStorage) ListBucket() ([]string, error) {
	bucket := gcs.client.Bucket(gcs.config.Bucket)
	it := bucket.Objects(gcs.ctx, nil)
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

func (gcs *GoogleCloudStorage) DeleteObject(key string) error {
	bucket := gcs.client.Bucket(gcs.config.Bucket)
	obj := bucket.Object(key)

	if err := obj.Delete(gcs.ctx); err != nil {
		return fmt.Errorf("Error deleting file %s from google cloud storage %v", key, err)
	}

	return nil
}

func (gcs *GoogleCloudStorage) Close() error {
	if err := gcs.client.Close(); err != nil {
		return fmt.Errorf("Error closing google cloud storage client: %v", err)
	}

	return nil
}
