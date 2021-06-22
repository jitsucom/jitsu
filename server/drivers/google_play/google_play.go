package google_play

import (
	"archive/zip"
	"bytes"
	"cloud.google.com/go/storage"
	"context"
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/server/drivers/base"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/parsers"
	"github.com/jitsucom/jitsu/server/typing"
	"google.golang.org/api/iterator"
	"google.golang.org/api/option"
	"io/ioutil"
	"strings"
	"time"
)

const (
	bucketPrefix = "pubsite_prod_rev_"

	SalesCollection    = "sales"
	EarningsCollection = "earnings"

	//"yyyyMM"
	intervalLayout = "200601"
)

var (
	salesTypeCasts = map[string]func(interface{}) (interface{}, error){
		"item_price":      typing.StringWithCommasToFloat,
		"charged_amount":  typing.StringWithCommasToFloat,
		"taxes_collected": typing.StringWithCommasToFloat,
	}

	earningsTypeCasts = map[string]func(interface{}) (interface{}, error){
		"amount__buyer_currency_":    typing.StringWithCommasToFloat,
		"currency_conversion_rate":   typing.StringWithCommasToFloat,
		"amount__merchant_currency_": typing.StringWithCommasToFloat,
	}
)

type GooglePlayConfig struct {
	AccountID  string                 `mapstructure:"account_id" json:"account_id,omitempty" yaml:"account_id,omitempty"`
	AccountKey *base.GoogleAuthConfig `mapstructure:"auth" json:"auth,omitempty" yaml:"auth,omitempty"`
}

func (gpc *GooglePlayConfig) Validate() error {
	if gpc == nil {
		return errors.New("GooglePlay config is required")
	}

	if gpc.AccountID == "" {
		return errors.New("GooglePlay account_id is required")
	}
	return gpc.AccountKey.Validate()
}

type GooglePlay struct {
	config *GooglePlayConfig
	client *storage.Client
	ctx    context.Context

	collection *base.Collection
}

func init() {
	if err := base.RegisterDriver(base.GooglePlayType, NewGooglePlay); err != nil {
		logging.Errorf("Failed to register driver %s: %v", base.GooglePlayType, err)
	}
}

func NewGooglePlay(ctx context.Context, sourceConfig *base.SourceConfig, collection *base.Collection) (base.Driver, error) {
	config := &GooglePlayConfig{}
	err := base.UnmarshalConfig(sourceConfig.Config, config)
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

func (gp *GooglePlay) GetCollectionMetaKey() string {
	return gp.collection.Name + "_" + gp.GetCollectionTable()
}

func (gp *GooglePlay) GetAllAvailableIntervals() ([]*base.TimeInterval, error) {
	bucketName := bucketPrefix + gp.config.AccountID
	bucket := gp.client.Bucket(bucketName)

	it := bucket.Objects(gp.ctx, &storage.Query{Prefix: gp.collection.Name})
	var intervals []*base.TimeInterval
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
		if gp.collection.Type == SalesCollection {
			if len(nameParts) != 2 {
				return nil, fmt.Errorf("GooglePlay file on gcp has wrong name: [%s]", attrs.Name)
			}
			intervalStr = strings.ReplaceAll(nameParts[1], ".zip", "")
		} else if gp.collection.Type == EarningsCollection {
			if len(nameParts) != 3 {
				return nil, fmt.Errorf("GooglePlay file on gcp has wrong name: [%s]", attrs.Name)
			}
			intervalStr = nameParts[1]
		} else {
			return nil, fmt.Errorf("GooglePlay unknown collection: %s", gp.collection.Type)
		}

		t, err := time.Parse(intervalLayout, intervalStr)
		if err != nil {
			return nil, fmt.Errorf("GooglePlay file on gcp has wrong interval layout: %s", attrs.Name)
		}

		intervals = append(intervals, base.NewTimeInterval(base.MONTH, t))
	}

	return intervals, nil
}

func (gp *GooglePlay) GetObjectsFor(interval *base.TimeInterval) ([]map[string]interface{}, error) {
	bucketName := bucketPrefix + gp.config.AccountID
	bucket := gp.client.Bucket(bucketName)

	var objects []map[string]interface{}
	var err error
	if gp.collection.Type == SalesCollection {
		key := "sales/salesreport_" + interval.LowerEndpoint().Format(intervalLayout) + ".zip"
		objects, err = gp.getFileObjects(bucket, key)
	} else if gp.collection.Type == EarningsCollection {
		prefix := "earnings/earnings_" + interval.LowerEndpoint().Format(intervalLayout)
		objects, err = gp.getFilesObjects(bucket, prefix)
	} else {
		return nil, fmt.Errorf("GooglePlay unknown collection: %s", gp.collection.Type)
	}

	if err != nil {
		return nil, fmt.Errorf("GooglePlay error getting objects for %s interval: %v", interval.String(), err)
	}

	return objects, nil
}

func (gp *GooglePlay) TestConnection() error {
	bucketName := bucketPrefix + gp.config.AccountID
	bucket := gp.client.Bucket(bucketName)

	it := bucket.Objects(gp.ctx, &storage.Query{Prefix: gp.collection.Name})
	_, err := it.Next()
	if err != nil && err != iterator.Done {
		return err
	}

	return nil
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
	if gp.collection.Type == SalesCollection {
		typeCasts = salesTypeCasts
	} else if gp.collection.Type == EarningsCollection {
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
	return base.GooglePlayType
}

func (gp *GooglePlay) Close() error {
	return gp.client.Close()
}
