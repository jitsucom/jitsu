package drivers

import (
	"cloud.google.com/go/firestore"
	"context"
	"errors"
	"firebase.google.com/go/v4"
	"firebase.google.com/go/v4/auth"
	"fmt"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/timestamp"
	"google.golang.org/api/iterator"
	"google.golang.org/api/option"
	"strings"
	"time"
)

const (
	firebaseType             = "firebase"
	firebaseCollectionPrefix = "firestore_"
)

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
	collection      *Collection
}

func init() {
	if err := RegisterDriverConstructor(firebaseType, NewFirebase); err != nil {
		logging.Errorf("Failed to register driver %s: %s", firebaseType, err)
	}
}

func NewFirebase(ctx context.Context, sourceConfig *SourceConfig, collection *Collection) (Driver, error) {
	config := &FirebaseConfig{}
	err := unmarshalConfig(sourceConfig.Config, config)
	if err != nil {
		return nil, err
	}
	if err := config.Validate(); err != nil {
		return nil, err
	}
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
	if strings.HasPrefix(f.collection.Type, firebaseCollectionPrefix) {
		firebaseCollectionName := strings.TrimPrefix(f.collection.Type, firebaseCollectionPrefix)
		return f.loadCollection(firebaseCollectionName)
	} else if f.collection.Type == "users" {
		return f.loadUsers()
	}
	return nil, fmt.Errorf("unknown collection: %s", f.collection)
}

func (f *Firebase) loadCollection(firestoreCollectionName string) ([]map[string]interface{}, error) {
	var documentJsons []map[string]interface{}
	iter := f.firestoreClient.Collection(firestoreCollectionName).Documents(f.ctx)
	for {
		doc, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("failed to get API keys from firestore: %v", err)
		}
		data := doc.Data()
		data["_firestore_document_id"] = doc.Ref.ID
		documentJsons = append(documentJsons, data)
	}
	return documentJsons, nil
}

func (f *Firebase) Type() string {
	return firebaseType
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
		user["uid"] = authUser.UID
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
