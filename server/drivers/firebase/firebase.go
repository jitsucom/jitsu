package firebase

import (
	"cloud.google.com/go/firestore"
	"context"
	"errors"
	"firebase.google.com/go/v4"
	"firebase.google.com/go/v4/auth"
	"fmt"
	"github.com/jitsucom/jitsu/server/drivers/base"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/timestamp"
	"google.golang.org/api/iterator"
	"google.golang.org/api/option"
	"strings"
	"time"
)

const (
	FirestoreCollection      = "firestore"
	UsersCollection          = "users"
	userIDField              = "uid"
	firestoreDocumentIDField = "_firestore_document_id"
)

//FirebaseConfig is a Firebase configuration dto for serialization
type FirebaseConfig struct {
	ProjectID   string `mapstructure:"project_id" json:"project_id,omitempty" yaml:"project_id,omitempty"`
	Credentials string `mapstructure:"key" json:"key,omitempty" yaml:"key,omitempty"`
}

//Validate returns err if configuration is invalid
func (fc *FirebaseConfig) Validate() error {
	if fc == nil {
		return errors.New("firebase config is required")
	}
	if fc.ProjectID == "" {
		return errors.New("project_id is not set")
	}
	if fc.Credentials == "" || !strings.HasPrefix(fc.Credentials, "{") {
		return errors.New("credentials must be a valid JSON")
	}
	return nil
}

//FirestoreParameters is a Firebase Firestore configuration dto for serialization
type FirestoreParameters struct {
	FirestoreCollection string `mapstructure:"collection" json:"collection,omitempty" yaml:"collection,omitempty"`
}

//Validate returns err if configuration is invalid
func (fp *FirestoreParameters) Validate() error {
	if fp == nil {
		return errors.New("'parameters' section is required")
	}
	if fp.FirestoreCollection == "" {
		return errors.New("'collection' is required firebase parameter")
	}
	return nil
}

//Firebase is a Firebase/Firestore driver. It used in syncing data from Firebase/Firestore
type Firebase struct {
	ctx                    context.Context
	config                 *FirebaseConfig
	firestoreClient        *firestore.Client
	authClient             *auth.Client
	collection             *base.Collection
	firestoreCollectionKey string
}

func init() {
	if err := base.RegisterDriver(base.FirebaseType, NewFirebase); err != nil {
		logging.Errorf("Failed to register driver %s: %v", base.FirebaseType, err)
	}
}

//NewFirebase returns configured Firebase driver instance
func NewFirebase(ctx context.Context, sourceConfig *base.SourceConfig, collection *base.Collection) (base.Driver, error) {
	config := &FirebaseConfig{}
	if err := base.UnmarshalConfig(sourceConfig.Config, config); err != nil {
		return nil, err
	}

	if err := config.Validate(); err != nil {
		return nil, err
	}

	if collection.Type != FirestoreCollection && collection.Type != UsersCollection {
		return nil, fmt.Errorf("Unsupported collection type %s: only [%s] and [%s] collections are allowed", collection.Type, UsersCollection, FirestoreCollection)
	}

	var firestoreCollectionKey string
	//check firestore collection Key
	if collection.Type == FirestoreCollection {
		parameters := &FirestoreParameters{}
		if err := base.UnmarshalConfig(collection.Parameters, parameters); err != nil {
			return nil, err
		}

		if err := parameters.Validate(); err != nil {
			return nil, err
		}

		firestoreCollectionKey = parameters.FirestoreCollection
	}

	app, err := firebase.NewApp(context.Background(),
		&firebase.Config{ProjectID: config.ProjectID},
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
		firestoreClient.Close()
		return nil, err
	}

	return &Firebase{
		config:                 config,
		ctx:                    ctx,
		firestoreClient:        firestoreClient,
		authClient:             authClient,
		collection:             collection,
		firestoreCollectionKey: firestoreCollectionKey,
	}, nil
}

func (f *Firebase) GetCollectionTable() string {
	return f.collection.GetTableName()
}

func (f *Firebase) GetCollectionMetaKey() string {
	return f.collection.Name + "_" + f.GetCollectionTable()
}

func (f *Firebase) GetAllAvailableIntervals() ([]*base.TimeInterval, error) {
	return []*base.TimeInterval{base.NewTimeInterval(base.ALL, time.Time{})}, nil
}

func (f *Firebase) GetObjectsFor(interval *base.TimeInterval) ([]map[string]interface{}, error) {
	if f.collection.Type == FirestoreCollection {
		return f.loadCollection()
	} else if f.collection.Type == UsersCollection {
		return f.loadUsers()
	}
	return nil, fmt.Errorf("Unknown collection: %s", f.collection.Type)
}

func (f *Firebase) TestConnection() error {
	iter := f.authClient.Users(f.ctx, "")

	_, err := iter.Next()
	if err != nil && err != iterator.Done {
		return err
	}

	return nil
}

func (f *Firebase) loadCollection() ([]map[string]interface{}, error) {
	var documentJSONs []map[string]interface{}
	iter := f.firestoreClient.Collection(f.firestoreCollectionKey).Documents(f.ctx)
	for {
		doc, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("failed to get API keys from firestore: %v", err)
		}
		data := doc.Data()
		data[firestoreDocumentIDField] = doc.Ref.ID
		documentJSONs = append(documentJSONs, data)
	}
	return documentJSONs, nil
}

func (f *Firebase) Type() string {
	return base.FirebaseType
}

func (f *Firebase) Close() error {
	return f.firestoreClient.Close()
}

func (f *Firebase) loadUsers() ([]map[string]interface{}, error) {
	iter := f.authClient.Users(f.ctx, "")
	var users []map[string]interface{}
	for {
		authUser, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, err
		}
		user := make(map[string]interface{})
		user["email"] = authUser.Email
		user[userIDField] = authUser.UID
		user["phone"] = authUser.PhoneNumber
		var signInMethods []string
		for _, info := range authUser.ProviderUserInfo {
			signInMethods = append(signInMethods, info.ProviderID)
		}
		user["sign_in_methods"] = signInMethods
		user["disabled"] = authUser.Disabled
		user["created_at"] = f.unixTimestampToISOString(authUser.UserMetadata.CreationTimestamp)
		user["last_login"] = f.unixTimestampToISOString(authUser.UserMetadata.LastLogInTimestamp)
		user["last_refresh"] = f.unixTimestampToISOString(authUser.UserMetadata.LastRefreshTimestamp)
		users = append(users, user)
	}
	return users, nil
}

func (f *Firebase) unixTimestampToISOString(nanoseconds int64) string {
	t := time.Unix(nanoseconds/1000, 0)
	return timestamp.ToISOFormat(t)
}
