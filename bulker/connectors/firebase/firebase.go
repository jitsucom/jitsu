package main

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"cloud.google.com/go/firestore"
	"firebase.google.com/go/v4/auth"
	"google.golang.org/api/iterator"
	"google.golang.org/api/option"
	"google.golang.org/genproto/googleapis/type/latlng"

	"firebase.google.com/go/v4"
	"github.com/jitsucom/bulker/airbytecdk"
)

const Layout = "2006-01-02T15:04:05.000000Z"

// Per-query page size for collection scans. Firestore enforces a server-side
// gRPC deadline (~60s) on Documents() queries; on large collections, scanning
// 10k docs per query reliably hit "Query timed out" / Unavailable. 500 is a
// safer middle ground — still amortizes the per-RPC overhead but completes
// well within the deadline even for collections with millions of docs.
const batchSize = 500

type FirebaseSource struct {
}

type FirebaseConfig struct {
	ProjectID         string `json:"projectId"`
	ServiceAccountKey string `json:"serviceAccountKey"`
}

type LastSyncTime struct {
	Timestamp int64 `json:"timestamp"`
}

func NewFirebaseSource() airbyte.Source {
	return &FirebaseSource{}
}

func (f FirebaseSource) Spec(logTracker airbyte.LogTracker) (*airbyte.ConnectorSpecification, error) {
	if err := logTracker.Log(airbyte.LogLevelInfo, "Running Spec"); err != nil {
		return nil, err
	}
	return &airbyte.ConnectorSpecification{
		SupportedDestinationSyncModes: []airbyte.DestinationSyncMode{
			airbyte.DestinationSyncModeOverwrite,
		},
		ConnectionSpecification: airbyte.ConnectionSpecification{
			Title:       "Firebase",
			Description: "Firebase (Firestore and User) Source connector",
			Type:        "object",
			Required:    []airbyte.PropertyName{"projectId", "serviceAccountKey"},
			Properties: airbyte.Properties{
				Properties: map[airbyte.PropertyName]airbyte.PropertySpec{
					"projectId": {
						Description: "Firebase Project ID from the Project Settings page",
						PropertyType: airbyte.PropertyType{
							Type: airbyte.String,
						},
					},
					"serviceAccountKey": {
						Description: "Auth (Service account key JSON)",
						PropertyType: airbyte.PropertyType{
							Type: airbyte.String,
						},
						IsSecret: true,
					},
				},
			},
		},
	}, nil
}

func (f FirebaseSource) Check(srcCfgPath string, logTracker airbyte.LogTracker) error {
	if err := logTracker.Log(airbyte.LogLevelDebug, "validating api connection"); err != nil {
		return err
	}
	var srcCfg FirebaseConfig
	err := airbyte.UnmarshalFromPath(srcCfgPath, &srcCfg)
	if err != nil {
		return err
	}

	ctx := context.Background()

	app, err := firebase.NewApp(ctx,
		&firebase.Config{ProjectID: srcCfg.ProjectID},
		option.WithCredentialsJSON([]byte(srcCfg.ServiceAccountKey)))
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

func (f FirebaseSource) Discover(srcCfgPath string, logTracker airbyte.LogTracker) (*airbyte.Catalog, error) {
	var srcCfg FirebaseConfig
	err := airbyte.UnmarshalFromPath(srcCfgPath, &srcCfg)
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Minute*3)
	defer cancel()

	app, err := firebase.NewApp(ctx,
		&firebase.Config{ProjectID: srcCfg.ProjectID},
		option.WithCredentialsJSON([]byte(srcCfg.ServiceAccountKey)))
	if err != nil {
		return nil, err
	}

	firestoreClient, err := app.Firestore(ctx)
	if err != nil {
		return nil, err
	}
	defer firestoreClient.Close()

	streams := make([]airbyte.Stream, 0, 10)

	iter := firestoreClient.Collections(ctx)
	for {
		collection, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, err
		}

		streams = append(streams, airbyte.Stream{
			Name:                    collection.ID,
			Namespace:               "firestore",
			SourceDefinedPrimaryKey: [][]string{{"id"}},
			JSONSchema:              airbyte.Properties{},
			SupportedSyncModes: []airbyte.SyncMode{
				airbyte.SyncModeFullRefresh,
				//airbyte.SyncModeIncremental,
			},
			SourceDefinedCursor: false,
		})
	}

	streams = append(streams, airbyte.Stream{
		Name:                    "users",
		Namespace:               "auth",
		SourceDefinedPrimaryKey: [][]string{{"uid"}},
		JSONSchema:              airbyte.Properties{},
		SupportedSyncModes: []airbyte.SyncMode{
			airbyte.SyncModeFullRefresh,
		},
		SourceDefinedCursor: false,
	})

	return &airbyte.Catalog{Streams: streams}, nil
}

type User struct {
	UserID int64  `json:"userid"`
	Name   string `json:"name"`
}

type Payment struct {
	UserID        int64 `json:"userid"`
	PaymentAmount int64 `json:"paymentAmount"`
}

func (f FirebaseSource) Read(sourceCfgPath string, prevStatePath string, configuredCat *airbyte.ConfiguredCatalog,
	tracker airbyte.MessageTracker) error {
	if err := tracker.Log(airbyte.LogLevelInfo, "Running read"); err != nil {
		return err
	}

	var srcCfg FirebaseConfig
	err := airbyte.UnmarshalFromPath(sourceCfgPath, &srcCfg)
	if err != nil {
		return err
	}

	// see if there is a last sync
	var st LastSyncTime
	_ = airbyte.UnmarshalFromPath(prevStatePath, &st)
	if st.Timestamp <= 0 {
		st.Timestamp = -1
	}

	ctx := context.Background()

	app, err := firebase.NewApp(ctx,
		&firebase.Config{ProjectID: srcCfg.ProjectID},
		option.WithCredentialsJSON([]byte(srcCfg.ServiceAccountKey)))
	if err != nil {
		return err
	}
	authClient, err := app.Auth(ctx)
	if err != nil {
		return err
	}
	firestoreClient, err := app.Firestore(ctx)
	if err != nil {
		return err
	}

	for _, stream := range configuredCat.Streams {
		if err := tracker.StreamStatus(stream.Stream.Name, stream.Stream.Namespace, airbyte.StreamStatusStarted); err != nil {
			return err
		}
		if stream.Stream.Namespace == "auth" && stream.Stream.Name == "users" {
			err = loadUsers(ctx, stream.Stream, authClient, tracker)
		} else {
			err = loadCollection(ctx, stream.Stream, firestoreClient, tracker)
		}
		if err != nil {
			_ = tracker.StreamStatus(stream.Stream.Name, stream.Stream.Namespace, airbyte.StreamStatusIncomplete)
			return err
		}
		if err := tracker.StreamStatus(stream.Stream.Name, stream.Stream.Namespace, airbyte.StreamStatusComplete); err != nil {
			return err
		}
	}

	return tracker.State(&LastSyncTime{
		Timestamp: time.Now().UnixMilli(),
	})
}

func loadUsers(ctx context.Context, stream airbyte.Stream, authClient *auth.Client, tracker airbyte.MessageTracker) error {
	iter := authClient.Users(ctx, "")
	var users []map[string]interface{}

	for {
		authUser, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return err
		}
		user := make(map[string]any)
		user["email"] = authUser.Email
		user["name"] = authUser.DisplayName
		user["uid"] = authUser.UID
		user["phone"] = authUser.PhoneNumber
		user["photo_url"] = authUser.PhotoURL
		var signInMethods []string
		for _, info := range authUser.ProviderUserInfo {
			signInMethods = append(signInMethods, info.ProviderID)
		}
		user["sign_in_methods"] = signInMethods
		user["disabled"] = authUser.Disabled
		user["created_at"] = unixTimestampToISOString(authUser.UserMetadata.CreationTimestamp)
		user["last_login"] = unixTimestampToISOString(authUser.UserMetadata.LastLogInTimestamp)
		user["last_refresh"] = unixTimestampToISOString(authUser.UserMetadata.LastRefreshTimestamp)
		users = append(users, user)
		err = tracker.Record(user, stream.Name, stream.Namespace)
		if err != nil {
			return err
		}
	}
	return nil
}

// loadCollection gets the exact firestore key or by path with wildcard:
//
//	collection/*/sub_collection/*/sub_sub_collection
func loadCollection(ctx context.Context, stream airbyte.Stream, firestoreClient *firestore.Client, tracker airbyte.MessageTracker) error {
	collection := firestoreClient.Collection(stream.Name)
	if collection == nil {
		return fmt.Errorf("collection [%s] doesn't exist in Firestore", stream.Name)
	}

	// Paginate by document ID. Order from the first batch on so the cursor is
	// stable across batches — without OrderBy on batch 1 the result order is
	// unspecified and StartAfter would skip / re-read documents.
	var lastDoc *firestore.DocumentSnapshot
	for {
		q := collection.OrderBy(firestore.DocumentID, firestore.Asc).Limit(batchSize)
		if lastDoc != nil {
			// Pass the snapshot (canonical form for __name__ cursors) rather
			// than the bare document ID string.
			q = q.StartAfter(lastDoc)
		}

		loaded := 0
		var newLastDoc *firestore.DocumentSnapshot
		iter := q.Documents(ctx)
		for {
			doc, err := iter.Next()
			if err == iterator.Done {
				break
			}
			if err != nil {
				return err
			}
			newLastDoc = doc
			loaded++

			data := doc.Data()
			if data == nil {
				continue
			}
			data = convertSpecificTypes(data)
			data["id"] = doc.Ref.ID
			colIter := doc.Ref.Collections(ctx)
			for {
				col, err := colIter.Next()
				if err == iterator.Done {
					break
				}
				if err != nil {
					return err
				}
				data[col.ID], err = collToJSONArray(ctx, col)
				if err != nil {
					return err
				}
			}

			err = tracker.Record(data, stream.Name, stream.Namespace)
			if err != nil {
				return err
			}
		}
		if loaded < batchSize {
			break
		}
		lastDoc = newLastDoc
	}
	return nil
}

func collToJSONArray(ctx context.Context, col *firestore.CollectionRef) (string, error) {
	docIter := col.Documents(ctx)
	arr := make([]map[string]any, 0)
	for {
		doc, err := docIter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return "", err
		}
		arr = append(arr, doc.Data())
	}
	b, err := json.Marshal(arr)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func unixTimestampToISOString(nanoseconds int64) string {
	t := time.Unix(nanoseconds/1000, 0)
	return t.Format(Layout)
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
