package firebase

import (
	"cloud.google.com/go/firestore"
	"context"
	"firebase.google.com/go/v4"
	"firebase.google.com/go/v4/auth"
	"github.com/jitsucom/jitsu/server/jsonutils"
	"github.com/jitsucom/jitsu/server/maputils"
	"github.com/jitsucom/jitsu/server/schema"
	"google.golang.org/genproto/googleapis/type/latlng"
	"strings"

	"fmt"
	"github.com/jitsucom/jitsu/server/drivers/base"
	"github.com/jitsucom/jitsu/server/timestamp"
	"google.golang.org/api/iterator"
	"google.golang.org/api/option"
	"time"
)

const (
	FirestoreCollection      = "firestore"
	UsersCollection          = "users"
	userIDField              = "uid"
	firestoreDocumentIDField = "_firestore_document_id"

	batchSize = 10000
)

type subCollectionResult struct {
	counter      int
	objectsChunk []map[string]interface{}
}

// Firebase is a Firebase/Firestore driver. It used in syncing data from Firebase/Firestore
type Firebase struct {
	base.IntervalDriver

	ctx                    context.Context
	config                 *FirebaseConfig
	firestoreClient        *firestore.Client
	authClient             *auth.Client
	collection             *base.Collection
	firestoreCollectionKey string
}

func init() {
	base.RegisterDriver(base.FirebaseType, NewFirebase)
	base.RegisterTestConnectionFunc(base.FirebaseType, TestFirebase)
}

// NewFirebase returns configured Firebase driver instance
func NewFirebase(ctx context.Context, sourceConfig *base.SourceConfig, collection *base.Collection) (base.Driver, error) {
	config := &FirebaseConfig{}
	if err := jsonutils.UnmarshalConfig(sourceConfig.Config, config); err != nil {
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
		if err := jsonutils.UnmarshalConfig(collection.Parameters, parameters); err != nil {
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
		IntervalDriver:         base.IntervalDriver{SourceType: sourceConfig.Type},
		config:                 config,
		ctx:                    ctx,
		firestoreClient:        firestoreClient,
		authClient:             authClient,
		collection:             collection,
		firestoreCollectionKey: firestoreCollectionKey,
	}, nil
}

// TestFirebase tests connection to Firebase without creating Driver instance
func TestFirebase(sourceConfig *base.SourceConfig) error {
	ctx := context.Background()
	config := &FirebaseConfig{}
	if err := jsonutils.UnmarshalConfig(sourceConfig.Config, config); err != nil {
		return err
	}

	if err := config.Validate(); err != nil {
		return err
	}

	app, err := firebase.NewApp(context.Background(),
		&firebase.Config{ProjectID: config.ProjectID},
		option.WithCredentialsJSON([]byte(config.Credentials)))
	if err != nil {
		return err
	}

	firestoreClient, err := app.Firestore(ctx)
	if err != nil {
		return err
	}
	defer firestoreClient.Close()

	authClient, err := app.Auth(ctx)
	if err != nil {
		return err
	}

	iter := authClient.Users(ctx, "")

	_, err = iter.Next()
	if err != nil && err != iterator.Done {
		return err
	}

	return nil
}

func (f *Firebase) GetCollectionTable() string {
	return f.collection.GetTableName()
}

func (f *Firebase) GetCollectionMetaKey() string {
	return f.collection.Name + "_" + f.GetCollectionTable()
}

func (f *Firebase) GetRefreshWindow() (time.Duration, error) {
	return time.Hour * 24, nil
}

func (f *Firebase) GetAllAvailableIntervals() ([]*base.TimeInterval, error) {
	return []*base.TimeInterval{base.NewTimeInterval(schema.ALL, time.Time{})}, nil
}

func (f *Firebase) GetObjectsFor(interval *base.TimeInterval, objectsLoader base.ObjectsLoader) error {
	if f.collection.Type == FirestoreCollection {
		return f.loadCollection(objectsLoader)
	} else if f.collection.Type == UsersCollection {
		return f.loadUsers(objectsLoader)
	}
	return fmt.Errorf("Unknown stream type: %s", f.collection.Type)
}

// loadCollection gets the exact firestore key or by path with wildcard:
//
//	collection/*/sub_collection/*/sub_sub_collection
func (f *Firebase) loadCollection(objectsLoader base.ObjectsLoader) error {
	collectionPaths := strings.Split(f.firestoreCollectionKey, "/*/")
	firstPathPart := collectionPaths[0]
	collectionPaths = collectionPaths[1:]
	firebaseCollection := f.firestoreClient.Collection(firstPathPart)
	if firebaseCollection == nil {
		return fmt.Errorf("collection [%s] (expression=%s) doesn't exist in Firestore", firstPathPart, f.firestoreCollectionKey)
	}

	result := &subCollectionResult{}
	err := f.diveAndFetch(firebaseCollection, map[string]interface{}{}, firestoreDocumentIDField, collectionPaths, objectsLoader, result, true)
	if err != nil {
		return err
	}

	return nil
}

// diveAndFetch depth-first dives into collections tree if not empty or
// fetches batches of data and puts into the result
func (f *Firebase) diveAndFetch(collection *firestore.CollectionRef, parentIDs map[string]interface{}, idFieldName string, paths []string, objectsLoader base.ObjectsLoader, result *subCollectionResult, flush bool) error {
	//firebase doesn't respect big requests
	iter := collection.Limit(batchSize).Documents(f.ctx)
	batchesCount := 0
	for {
		docs, err := iter.GetAll()
		if err != nil {
			return err
		}
		for _, doc := range docs {
			//dive
			if len(paths) > 0 {
				subCollectionName := paths[0]
				subCollection := doc.Ref.Collection(subCollectionName)
				if subCollection == nil {
					continue
				}

				//get parent ID
				parentIDs = maputils.CopyMap(parentIDs)
				parentIDs[idFieldName] = doc.Ref.ID

				subCollectionIDField := idFieldName + "_" + subCollectionName

				err := f.diveAndFetch(subCollection, parentIDs, subCollectionIDField, paths[1:], objectsLoader, result, false)
				if err != nil {
					return err
				}
			} else {
				//fetch
				data := doc.Data()
				if data == nil {
					continue
				}
				data = convertSpecificTypes(data)

				data[idFieldName] = doc.Ref.ID

				//parent ids
				for parentIDKey, parentIDValue := range parentIDs {
					data[parentIDKey] = parentIDValue
				}

				result.objectsChunk = append(result.objectsChunk, data)
				if len(result.objectsChunk) == batchSize {
					err = objectsLoader(result.objectsChunk, result.counter, -1, -1)
					if err != nil {
						return err
					}
					result.counter += len(result.objectsChunk)
					result.objectsChunk = nil
				}
			}
		}
		batchesCount++
		if len(docs) == batchSize {
			iter = collection.OrderBy(firestore.DocumentID, firestore.Asc).StartAfter(docs[batchSize-1].Ref.ID).Limit(batchSize).Documents(f.ctx)
		} else {
			break
		}
	}
	if len(result.objectsChunk) > 0 && flush {
		err := objectsLoader(result.objectsChunk, result.counter, -1, -1)
		if err != nil {
			return err
		}
		result.counter += len(result.objectsChunk)
		result.objectsChunk = nil
	}
	return nil
}

func (f *Firebase) Type() string {
	return base.FirebaseType
}

func (f *Firebase) Close() error {
	return f.firestoreClient.Close()
}

func (f *Firebase) loadUsers(objectsLoader base.ObjectsLoader) error {
	iter := f.authClient.Users(f.ctx, "")
	var users []map[string]interface{}
	loaded := 0

	for {
		authUser, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return err
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
		if len(users) == batchSize {
			err = objectsLoader(users, loaded, -1, -1)
			if err != nil {
				return err
			}
			loaded += len(users)
			users = nil
		}
	}
	if len(users) > 0 {
		err := objectsLoader(users, loaded, -1, -1)
		if err != nil {
			return err
		}
	}
	return nil
}

func (f *Firebase) unixTimestampToISOString(nanoseconds int64) string {
	t := time.Unix(nanoseconds/1000, 0)
	return timestamp.ToISOFormat(t)
}

func convertSpecificTypes(source map[string]interface{}) map[string]interface{} {
	for name, value := range source {
		switch v := value.(type) {
		case *latlng.LatLng:
			source[name+".latitude"] = v.GetLatitude()
			source[name+".longitude"] = v.GetLongitude()
			delete(source, name)
		case latlng.LatLng:
			source[name+".latitude"] = v.GetLatitude()
			source[name+".longitude"] = v.GetLongitude()
			delete(source, name)
		case map[string]interface{}:
			source[name] = convertSpecificTypes(v)
		}
	}
	return source
}
