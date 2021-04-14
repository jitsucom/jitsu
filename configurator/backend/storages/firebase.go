package storages

import (
	"cloud.google.com/go/firestore"
	"context"
	"encoding/json"
	"errors"
	firebase "firebase.google.com/go/v4"
	"fmt"
	entime "github.com/jitsucom/jitsu/configurator/time"
	"google.golang.org/api/iterator"
	"google.golang.org/api/option"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"time"
)

type Firebase struct {
	ctx    context.Context
	client *firestore.Client
}

func NewFirebase(ctx context.Context, projectID string, credentialsFile string) (ConfigurationsStorage, error) {
	fbConfig := &firebase.Config{ProjectID: projectID}
	app, err := firebase.NewApp(ctx, fbConfig, option.WithCredentialsFile(credentialsFile))
	if err != nil {
		return nil, err
	}

	firestoreClient, err := app.Firestore(ctx)
	if err != nil {
		return nil, err
	}

	return &Firebase{ctx: ctx, client: firestoreClient}, nil
}

func (fb *Firebase) Get(collection string, documentID string) ([]byte, error) {
	data, err := fb.client.Collection(collection).Doc(documentID).Get(fb.ctx)
	if err != nil {
		if status.Code(err) == codes.NotFound {
			return nil, ErrConfigurationNotFound
		}
		return nil, err
	}
	return json.Marshal(data.Data())
}

func (fb *Firebase) GetAllGroupedByID(collection string) ([]byte, error) {
	iter := fb.client.Collection(collection).Documents(fb.ctx)
	configurations := make(map[string]interface{})
	for {
		doc, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("failed to get destinations from firestore: %v", err)
		}
		entity := doc.Data()
		configurations[doc.Ref.ID] = entity
	}
	data, err := json.Marshal(configurations)
	if err != nil {
		return nil, err
	}
	return data, nil
}

func (fb *Firebase) GetCollectionLastUpdated(collection string) (*time.Time, error) {
	result := fb.client.Collection(collection).Select(lastUpdatedField).OrderBy(lastUpdatedField, firestore.Desc).Limit(1).Documents(fb.ctx)
	docs, err := result.GetAll()
	if err != nil {
		return nil, fmt.Errorf("Error getting _lastUpdated: %v", err)
	}

	if len(docs) == 0 {
		return nil, fmt.Errorf("Empty [%s] _lastUpdated", collection)
	}
	lastUpdated, err := docs[0].DataAt(lastUpdatedField)
	if err != nil {
		return nil, err
	}
	lastUpdatedString, ok := lastUpdated.(string)
	if !ok {
		return nil, errors.New(lastUpdatedField + " is not a string")
	}
	t, err := time.Parse(LastUpdatedLayout, lastUpdatedString)
	if err != nil {
		return nil, fmt.Errorf("Failed to convert [%s] to time: %v", lastUpdatedString, err)
	}
	return &t, nil
}

func (fb *Firebase) Store(collection string, documentID string, entity interface{}) error {
	_, err := fb.client.Collection(collection).Doc(documentID).Set(fb.ctx, entity)
	if err != nil {
		return err
	}
	var updates []firestore.Update
	updates = append(updates, firestore.Update{Path: lastUpdatedField, Value: entime.AsISOString(time.Now().UTC())})
	_, err = fb.client.Collection(collection).Doc(documentID).Update(fb.ctx, updates)
	return err
}

func (fb *Firebase) Close() error {
	if err := fb.client.Close(); err != nil {
		return err
	}
	return nil
}
