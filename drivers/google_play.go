package drivers

import (
	"archive/zip"
	"bytes"
	"cloud.google.com/go/storage"
	"context"
	"errors"
	"fmt"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/parsers"
	"github.com/jitsucom/eventnative/typing"
	"google.golang.org/api/iterator"
	"google.golang.org/api/option"
	"io/ioutil"
	"strings"
	"time"
)

const (
	googlePlayType = "google_play"
	bucketPrefix   = "pubsite_prod_rev_"

	salesCollection    = "sales"
	earningsCollection = "earnings"

	//"yyyyMM"
	intervalLayout = "200601"
)

var (
	salesTypeCasts = map[string]func(interface{}) (interface{}, error){
		"item_price":      typing.StringWithCommasToFloat,
		"charged_amount":  typing.StringWithCommasToFloat,
		"taxes_collected": typing.StringWithCommasToFloat,
		//"postal_code_of_buyer": typing.StringToInt,
	}

	earningsTypeCasts = map[string]func(interface{}) (interface{}, error){
		//"product_type": typing.StringToInt,
		//"buyer_postal_code": typing.StringToInt,
		"amount__buyer_currency_":    typing.StringWithCommasToFloat,
		"currency_conversion_rate":   typing.StringWithCommasToFloat,
		"amount__merchant_currency_": typing.StringWithCommasToFloat,
	}
)

type GooglePlayConfig struct {
	AccountId  string            `mapstructure:"account_id" json:"account_id,omitempty" yaml:"account_id,omitempty"`
	AccountKey *GoogleAuthConfig `mapstructure:"auth" json:"auth,omitempty" yaml:"auth,omitempty"`
}

func (gpc *GooglePlayConfig) Validate() error {
	if gpc == nil {
		return errors.New("GooglePlay config is required")
	}

	if gpc.AccountId == "" {
		return errors.New("GooglePlay account_id is required")
	}
	return gpc.AccountKey.Validate()
}

type GooglePlay struct {
	config *GooglePlayConfig
	client *storage.Client
	ctx    context.Context

	collection *Collection
}

func init() {
	if err := RegisterDriverConstructor(googlePlayType, NewGooglePlay); err != nil {
		logging.Errorf("Failed to register driver %s: %v", googlePlayType, err)
	}
}

func NewGooglePlay(ctx context.Context, sourceConfig *SourceConfig, collection *Collection) (Driver, error) {
	config := &GooglePlayConfig{}
	err := unmarshalConfig(sourceConfig.Config, config)
	if err != nil {
		return nil, err
	}
	if err := config.Validate(); err != nil {
		return nil, err
	}
	credentialsJSON, err := config.AccountKey.Marshal()
	if err != nil {
		return nil, err
	}
	client, err := storage.NewClient(ctx, option.WithCredentialsJSON(credentialsJSON))
	if err != nil {
		return nil, fmt.Errorf("GooglePlay error creating google cloud storage client: %v", err)
	}

	return &GooglePlay{client: client, config: config, ctx: ctx, collection: collection}, nil
}

func (gp *GooglePlay) GetCollectionTable() string {
	return gp.collection.GetTableName()
}

func (gp *GooglePlay) GetAllAvailableIntervals() ([]*TimeInterval, error) {
	bucketName := bucketPrefix + gp.config.AccountId
	bucket := gp.client.Bucket(bucketName)

	it := bucket.Objects(gp.ctx, &storage.Query{Prefix: gp.collection.Name})
	var intervals []*TimeInterval
	for {
		attrs, err := it.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("GooglePlay Error reading object from gcp bucket [%s]: %v", bucketName, err)
		}

		nameParts := strings.Split(attrs.Name, "_")

		var intervalStr string
		if gp.collection.Type == salesCollection {
			if len(nameParts) != 2 {
				return nil, fmt.Errorf("GooglePlay file on gcp has wrong name: [%s]", attrs.Name)
			}
			intervalStr = strings.ReplaceAll(nameParts[1], ".zip", "")
		} else if gp.collection.Type == earningsCollection {
			if len(nameParts) != 3 {
				return nil, fmt.Errorf("GooglePlay file on gcp has wrong name: [%s]", attrs.Name)
			}
			intervalStr = nameParts[1]
		} else {
			return nil, fmt.Errorf("GooglePlay unknown collection: %s", gp.collection)
		}

		t, err := time.Parse(intervalLayout, intervalStr)
		if err != nil {
			return nil, fmt.Errorf("GooglePlay file on gcp has wrong interval layout: %s", attrs.Name)
		}

		intervals = append(intervals, NewTimeInterval(MONTH, t))
	}

	return intervals, nil
}

func (gp *GooglePlay) GetObjectsFor(interval *TimeInterval) ([]map[string]interface{}, error) {
	bucketName := bucketPrefix + gp.config.AccountId
	bucket := gp.client.Bucket(bucketName)

	var objects []map[string]interface{}
	var err error
	if gp.collection.Type == salesCollection {
		key := "sales/salesreport_" + interval.LowerEndpoint().Format(intervalLayout) + ".zip"
		objects, err = gp.getFileObjects(bucket, key)
	} else if gp.collection.Type == earningsCollection {
		prefix := "earnings/earnings_" + interval.LowerEndpoint().Format(intervalLayout)
		objects, err = gp.getFilesObjects(bucket, prefix)
	} else {
		return nil, fmt.Errorf("GooglePlay unknown collection: %s", gp.collection)
	}

	if err != nil {
		return nil, fmt.Errorf("GooglePlay error getting objects for %s interval: %v", interval.String(), err)
	}

	return objects, nil
}

func (gp *GooglePlay) getFilesObjects(bucket *storage.BucketHandle, prefix string) ([]map[string]interface{}, error) {
	var objects []map[string]interface{}

	it := bucket.Objects(gp.ctx, &storage.Query{Prefix: prefix})
	for {
		attrs, err := it.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, err
		}

		fileObjects, err := gp.getFileObjects(bucket, attrs.Name)
		if err != nil {
			return nil, err
		}

		objects = append(objects, fileObjects...)
	}

	return objects, nil
}

func (gp *GooglePlay) getFileObjects(bucket *storage.BucketHandle, key string) ([]map[string]interface{}, error) {
	var objects []map[string]interface{}
	typeCasts := map[string]func(interface{}) (interface{}, error){}
	if gp.collection.Type == salesCollection {
		typeCasts = salesTypeCasts
	} else if gp.collection.Type == earningsCollection {
		typeCasts = earningsTypeCasts
	}

	obj := bucket.Object(key)

	r, err := obj.NewReader(gp.ctx)
	if err != nil {
		return nil, err
	}
	defer r.Close()

	b, err := ioutil.ReadAll(r)

	zipReader, err := zip.NewReader(bytes.NewReader(b), int64(len(b)))
	if err != nil {
		return nil, err
	}

	for _, zipFile := range zipReader.File {
		zipFileReader, err := zipFile.Open()
		if err != nil {
			return nil, err
		}

		parsed, err := parsers.ParseCsv(zipFileReader, typeCasts)
		zipFileReader.Close()

		if err != nil {
			return nil, err
		}

		objects = append(objects, parsed...)
	}

	return objects, nil
}

func (gp *GooglePlay) Type() string {
	return googlePlayType
}

func (gp *GooglePlay) Close() error {
	return gp.client.Close()
}
