package google_play

import (
	"archive/zip"
	"bytes"
	"cloud.google.com/go/storage"
	"context"
	"fmt"
	"github.com/jitsucom/jitsu/server/drivers/base"
	"github.com/jitsucom/jitsu/server/jsonutils"
	"github.com/jitsucom/jitsu/server/parsers"
	"github.com/jitsucom/jitsu/server/schema"
	"github.com/jitsucom/jitsu/server/typing"
	"google.golang.org/api/iterator"
	"google.golang.org/api/option"
	"io/ioutil"
	"strings"
	"time"
)

const (
	bucketPrefixLegacy = "pubsite_prod_rev_"
	bucketPrefix       = "pubsite_prod_"

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

type GooglePlay struct {
	base.IntervalDriver

	config *GooglePlayConfig
	client *storage.Client
	ctx    context.Context

	collection *base.Collection
}

func init() {
	base.RegisterDriver(base.GooglePlayType, NewGooglePlay)
	base.RegisterTestConnectionFunc(base.GooglePlayType, TestGooglePlay)
}

//NewGooglePlay returns configured Google Play driver instance
func NewGooglePlay(ctx context.Context, sourceConfig *base.SourceConfig, collection *base.Collection) (base.Driver, error) {
	config := &GooglePlayConfig{}
	err := jsonutils.UnmarshalConfig(sourceConfig.Config, config)
	if err != nil {
		return nil, err
	}
	config.AccountKey.FillPreconfiguredOauth(base.GooglePlayType)
	if err := config.Validate(); err != nil {
		return nil, err
	}

	credentialsJSON, err := config.AccountKey.Marshal()
	if err != nil {
		return nil, err
	}
	client, err := storage.NewClient(ctx, option.WithCredentialsJSON(credentialsJSON),
		option.WithScopes("https://www.googleapis.com/auth/devstorage.read_only"))
	if err != nil {
		return nil, fmt.Errorf("GooglePlay error creating google cloud storage client: %v", err)
	}

	return &GooglePlay{
		IntervalDriver: base.IntervalDriver{SourceType: sourceConfig.Type},
		client:         client,
		config:         config,
		ctx:            ctx,
		collection:     collection,
	}, nil
}

//TestGooglePlay tests connection to Google Play without creating Driver instance
func TestGooglePlay(sourceConfig *base.SourceConfig) error {
	config := &GooglePlayConfig{}
	err := jsonutils.UnmarshalConfig(sourceConfig.Config, config)
	if err != nil {
		return err
	}
	config.AccountKey.FillPreconfiguredOauth(base.GooglePlayType)
	if err := config.Validate(); err != nil {
		return err
	}

	credentialsJSON, err := config.AccountKey.Marshal()
	if err != nil {
		return err
	}

	client, err := storage.NewClient(context.Background(),
		option.WithCredentialsJSON(credentialsJSON),
		option.WithScopes("https://www.googleapis.com/auth/devstorage.read_only"))
	if err != nil {
		return fmt.Errorf("GooglePlay error creating google cloud storage client: %v", err)
	}
	defer client.Close()
	bucket := client.Bucket(getBucketName(config.AccountID))

	it := bucket.Objects(context.Background(), &storage.Query{})
	_, err = it.Next()
	if err != nil && err != iterator.Done {
		return err
	}

	return nil
}

func (gp *GooglePlay) GetCollectionTable() string {
	return gp.collection.GetTableName()
}

func (gp *GooglePlay) GetCollectionMetaKey() string {
	return gp.collection.Name + "_" + gp.GetCollectionTable()
}

func (gp *GooglePlay) GetRefreshWindow() (time.Duration, error) {
	return time.Hour * 24 * 31, nil
}

func (gp *GooglePlay) GetAllAvailableIntervals() ([]*base.TimeInterval, error) {
	bucketName := getBucketName(gp.config.AccountID)
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

		intervals = append(intervals, base.NewTimeInterval(schema.MONTH, t))
	}

	return intervals, nil
}

func (gp *GooglePlay) GetObjectsFor(interval *base.TimeInterval, objectsLoader base.ObjectsLoader) error {
	bucketName := getBucketName(gp.config.AccountID)
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
		return fmt.Errorf("GooglePlay unknown collection: %s", gp.collection.Type)
	}
	if err != nil {
		return err
	}
	return objectsLoader(objects, 0, len(objects), 0)
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

func getBucketName(accountId string) string {
	if !strings.HasPrefix(accountId, bucketPrefix) {
		return bucketPrefixLegacy + accountId
	}
	return accountId
}
