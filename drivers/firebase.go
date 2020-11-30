package drivers

import (
	"cloud.google.com/go/firestore"
	"context"
	"errors"
	"firebase.google.com/go/v4"
	"firebase.google.com/go/v4/auth"
	"fmt"
	"github.com/jitsucom/eventnative/timestamp"
	"google.golang.org/api/iterator"
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
	collection      *Collection
}

func NewFirebase(ctx context.Context, config *FirebaseConfig, collection *Collection) (*Firebase, error) {
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
	if strings.HasPrefix(f.collection.Name, firebaseCollectionPrefix) {
		firebaseCollectionName := strings.TrimPrefix(f.collection.Name, firebaseCollectionPrefix)
		return f.loadCollection(firebaseCollectionName)
	} else if f.collection.Name == "users" {
		return f.loadUsers()
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
		data := snapshot.Data()
		data["_firestore_document_id"] = document.ID
		documentJsons = append(documentJsons, data)
	}
	return documentJsons, nil
}

func (f *Firebase) Type() string {
	return FirebaseType
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
