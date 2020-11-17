package drivers

import (
	"cloud.google.com/go/firestore"
	"context"
	"errors"
	"firebase.google.com/go/v4"
	"firebase.google.com/go/v4/auth"
	"fmt"
	"google.golang.org/api/option"
	"strings"
	"time"
)

const firebaseCollectionPrefix = "firestore_"

type FirebaseConfig struct {
	ProjectId   string `mapstructure:"project_id" json:"project_id,omitempty" yaml:"project_id,omitempty"`
	Credentials string `mapstructure:"key" json:"key,omitempty" yaml:"key,omitempty"`
}

func (fc *FirebaseConfig) Validate() error {
	if fc == nil {
		return errors.New("firebase config is required")
	}
	if fc.ProjectId == "" {
		return errors.New("project_id is not set")
	}
	if fc.Credentials == "" || !strings.HasPrefix(fc.Credentials, "{") || !strings.HasSuffix(fc.Credentials, "}") {
		return errors.New("credentials must be a valid JSON")
	}

	return nil
}

type Firebase struct {
	config          *FirebaseConfig
	ctx             context.Context
	firestoreClient *firestore.Client
	authClient      *auth.Client

	collection string
}

func NewFirebase(ctx context.Context, config *FirebaseConfig, collection string) (*Firebase, error) {
	app, err := firebase.NewApp(context.Background(),
		&firebase.Config{ProjectID: config.ProjectId},
		option.WithCredentialsJSON([]byte(config.Credentials)))
	if err != nil {
		return nil, err
	}
	firestoreClient, err := app.Firestore(ctx)
	if err != nil {
		return nil, err
	}
	authClient, err := app.Auth(ctx)
	if err != nil {
		return nil, err
	}
	return &Firebase{config: config, ctx: ctx, firestoreClient: firestoreClient, authClient: authClient, collection: collection}, nil
}

func (f *Firebase) GetAllAvailableIntervals() ([]*TimeInterval, error) {
	return []*TimeInterval{NewTimeInterval(ALL, time.Time{})}, nil
}

func (f *Firebase) GetObjectsFor(interval *TimeInterval) ([]map[string]interface{}, error) {
	if strings.HasPrefix(f.collection, firebaseCollectionPrefix) {
		firebaseCollectionName := strings.TrimPrefix(f.collection, firebaseCollectionPrefix)
		return f.loadCollection(firebaseCollectionName)
	} else if f.collection == "users" {

	}
	return nil, fmt.Errorf("unknown collection: %s", f.collection)
}

func (f *Firebase) loadCollection(firestoreCollectionName string) ([]map[string]interface{}, error) {
	collectionData := f.firestoreClient.Collection(firestoreCollectionName)
	documents, err := collectionData.DocumentRefs(f.ctx).GetAll()
	if err != nil {
		return nil, err
	}
	var documentJsons []map[string]interface{}
	for _, document := range documents {
		snapshot, err := document.Get(f.ctx)
		if err != nil {
			return nil, err
		}
		documentJsons = append(documentJsons, snapshot.Data())
	}
	return documentJsons, nil
}

func (f *Firebase) Type() string {
	return FirebaseType
}

func (f *Firebase) Close() error {
	return f.firestoreClient.Close()
}
