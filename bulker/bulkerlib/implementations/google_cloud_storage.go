package implementations

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	types2 "github.com/jitsucom/bulker/bulkerlib/types"
	"github.com/jitsucom/bulker/jitsubase/errorj"
	"github.com/jitsucom/bulker/jitsubase/jsoniter"
	"github.com/jitsucom/bulker/jitsubase/logging"
	"github.com/jitsucom/bulker/jitsubase/utils"
	"io"
	"strings"
	"time"

	"go.uber.org/atomic"

	"cloud.google.com/go/storage"
	"google.golang.org/api/option"
)

const GCSBulkerTypeId = "gcs"

var ErrMalformedBQDataset = errors.New("bq_dataset must be alphanumeric (plus underscores) and must be at most 1024 characters long")

type GoogleConfig struct {
	FileConfig `mapstructure:",squash" json:",inline" yaml:",inline"`
	Bucket     string `mapstructure:"gcsBucket,omitempty" json:"gcsBucket,omitempty" yaml:"gcsBucket,omitempty"`
	Project    string `mapstructure:"project,omitempty" json:"project,omitempty" yaml:"project,omitempty"`
	Dataset    string `mapstructure:"bqDataset,omitempty" json:"bqDataset,omitempty" yaml:"bqDataset,omitempty"`
	KeyFile    any    `mapstructure:"keyFile,omitempty" json:"keyFile,omitempty" yaml:"keyFile,omitempty"`

	//will be set on validation
	Credentials option.ClientOption
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
			if symbol != '_' && !utils.IsLetterOrNumber(symbol) {
				return fmt.Errorf("%s: '%s'", ErrMalformedBQDataset.Error(), string(symbol))
			}
		}
	}
	// An explicit credential is mandatory. Ambient / Application Default
	// Credentials — the "workload_identity" sentinel, or an absent/empty
	// keyFile that would otherwise fall through to ADC — is rejected outright:
	// bulker would authenticate as its own service account against an
	// attacker-controlled destination config, a confused deputy (e.g. writing
	// to another tenant's event-archive bucket). Every success path below sets
	// gc.Credentials, so no caller ever constructs an ADC client.
	switch keyFile := gc.KeyFile.(type) {
	case map[string]any:
		if len(keyFile) == 0 {
			return errors.New("Google keyFile is required parameter")
		}
		b, err := jsoniter.Marshal(keyFile)
		if err != nil {
			return fmt.Errorf("Malformed google keyFile: %v", err)
		}
		gc.Credentials = option.WithCredentialsJSON(b)
	case string:
		if keyFile == "" || keyFile == "workload_identity" {
			return errors.New("Google keyFile is required parameter (ambient/workload_identity credentials are not permitted)")
		}
		if strings.Contains(keyFile, "{") {
			gc.Credentials = option.WithCredentialsJSON([]byte(keyFile))
		} else {
			gc.Credentials = option.WithCredentialsFile(keyFile)
		}
	default:
		return errors.New("Google key_file must be string or json object")
	}

	return nil
}

type GoogleCloudStorage struct {
	AbstractFileAdapter
	config *GoogleConfig
	client *storage.Client

	closed *atomic.Bool
}

func NewGoogleCloudStorage(config *GoogleConfig) (*GoogleCloudStorage, error) {
	// Validate both surfaces config errors AND guarantees an explicit
	// credential (it rejects everything that would leave Credentials nil), so
	// there is no ADC / ambient-identity client path here.
	if err := config.Validate(); err != nil {
		return nil, err
	}
	client, err := storage.NewClient(context.Background(), config.Credentials)
	if err != nil {
		return nil, fmt.Errorf("Error creating google cloud storage client: %v", err)
	}

	if config.Format == "" {
		config.Format = types2.FileFormatNDJSON
	}

	return &GoogleCloudStorage{AbstractFileAdapter: AbstractFileAdapter{config: &config.FileConfig}, client: client, config: config, closed: atomic.NewBool(false)}, nil
}

func (gcs *GoogleCloudStorage) UploadBytes(fileName string, fileBytes []byte) error {
	return gcs.Upload(fileName, bytes.NewReader(fileBytes))
}

// UploadBytes creates named file on google cloud storage with payload
func (gcs *GoogleCloudStorage) Upload(fileName string, fileReader io.ReadSeeker) (err error) {
	fileName = gcs.Path(fileName)

	//panic handler
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("panic while uploading file: %s to GCC project: %s bucket: %s dataset: %s : %v", fileName, gcs.config.Project, gcs.config.Bucket, gcs.config.Dataset, r)
			logging.SystemError(err.Error())
		}
	}()
	if gcs.closed.Load() {
		return fmt.Errorf("attempt to use closed GoogleCloudStorage instance")
	}
	bucket := gcs.client.Bucket(gcs.config.Bucket)
	object := bucket.Object(fileName)
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute*5)
	defer cancel()
	w := object.NewWriter(ctx)

	if _, err := io.Copy(w, fileReader); err != nil {
		return errorj.SaveOnStageError.Wrap(err, "failed to write file to google cloud storage").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Bucket:    gcs.config.Bucket,
				Statement: fmt.Sprintf("file: %s", fileName),
			})
	}

	if err := w.Close(); err != nil {
		return errorj.SaveOnStageError.Wrap(err, "failed to close google cloud writer").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Bucket:    gcs.config.Bucket,
				Statement: fmt.Sprintf("file: %s", fileName),
			})
	}
	metadata := storage.ObjectAttrsToUpdate{}
	if gcs.config.Compression == types2.FileCompressionGZIP {
		metadata.ContentType = "application/gzip"
	} else {
		if gcs.config.Format == types2.FileFormatCSV {
			metadata.ContentType = "text/csv"
		} else if gcs.config.Format == types2.FileFormatNDJSON || gcs.config.Format == types2.FileFormatNDJSONFLAT {
			metadata.ContentType = "application/x-ndjson"
		}
	}
	if _, err := object.Update(context.Background(), metadata); err != nil {
		return errorj.SaveOnStageError.Wrap(err, "failed to set Content-Type metadata").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Bucket:    gcs.config.Bucket,
				Statement: fmt.Sprintf("file: %s", fileName),
			})
	}

	return nil
}

func (gcs *GoogleCloudStorage) GetObjectURL(fileName string) (string, error) {
	fileName = gcs.Path(fileName)
	return fmt.Sprintf("https://storage.googleapis.com/%s/%s", gcs.config.Bucket, fileName), nil
}

// Download downloads file from google cloud storage bucket
func (gcs *GoogleCloudStorage) Download(key string) (fileBytes []byte, err error) {
	key = gcs.Path(key)
	//panic handler
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("panic while downloading file: %s from GCC project: %s bucket: %s dataset: %s : %v", key, gcs.config.Project, gcs.config.Bucket, gcs.config.Dataset, r)
			logging.SystemError(err.Error())
		}
	}()
	if gcs.closed.Load() {
		return nil, fmt.Errorf("attempt to use closed GoogleCloudStorage instance")
	}
	bucket := gcs.client.Bucket(gcs.config.Bucket)
	obj := bucket.Object(key)

	r, err := obj.NewReader(context.Background())
	if err != nil {
		return nil, errorj.SaveOnStageError.Wrap(err, "failed to create google cloud reader").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Bucket:    gcs.config.Bucket,
				Statement: fmt.Sprintf("file: %s", key),
			})
	}
	defer r.Close()

	fileBytes, err = io.ReadAll(r)
	if err != nil {
		return nil, errorj.SaveOnStageError.Wrap(err, "failed to read google cloud reader").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Bucket:    gcs.config.Bucket,
				Statement: fmt.Sprintf("file: %s", key),
			})
	}

	return fileBytes, nil
}

// DeleteObject deletes object from google cloud storage bucket
func (gcs *GoogleCloudStorage) DeleteObject(key string) (err error) {
	key = gcs.Path(key)
	//panic handler
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("panic while deleting file: %s to GCC project: %s bucket: %s dataset: %s : %v", key, gcs.config.Project, gcs.config.Bucket, gcs.config.Dataset, r)
			logging.SystemError(err.Error())
		}
	}()
	if gcs.closed.Load() {
		return fmt.Errorf("attempt to use closed GoogleCloudStorage instance")
	}
	bucket := gcs.client.Bucket(gcs.config.Bucket)
	obj := bucket.Object(key)

	if err := obj.Delete(context.Background()); err != nil {
		return errorj.SaveOnStageError.Wrap(err, "failed to delete from google cloud").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Bucket:    gcs.config.Bucket,
				Statement: fmt.Sprintf("file: %s", key),
			})
	}

	return nil
}

// ValidateWritePermission tries to create temporary file and remove it.
// returns nil if file creation was successful.
func (gcs *GoogleCloudStorage) ValidateWritePermission() error {
	filename := fmt.Sprintf("test_%v", time.Now())

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

func (gcs *GoogleCloudStorage) Type() string {
	return GCSBulkerTypeId
}

func (gcs *GoogleCloudStorage) Ping() error {
	return nil
}
