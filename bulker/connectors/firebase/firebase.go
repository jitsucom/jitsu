package main

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
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
	// SubcollectionPaths lists subcollections to sync as their own streams,
	// expressed as the chain of collection IDs, e.g. "users/orders" or
	// "users/orders/items". Document-id placeholders ("*") are ignored, so
	// "users/*/orders" is equivalent to "users/orders". Each path is read via
	// a CollectionGroup query on the last token, then filtered by the full
	// path — so subcollections under non-existent ("phantom") parent documents
	// are still picked up.
	SubcollectionPaths []string `json:"subcollectionPaths"`
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
					"subcollectionPaths": {
						Description: "Optional list of subcollections to sync as their own streams, " +
							"expressed as the chain of collection IDs (e.g. \"users/orders\"). " +
							"Each is read via a CollectionGroup query, so subcollections under " +
							"missing (\"phantom\") parent documents are included.",
						PropertyType: airbyte.PropertyType{
							Type: airbyte.Array,
						},
						Items: map[string]interface{}{
							"type": "string",
						},
						Examples: []string{"users/orders", "users/orders/items"},
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

	// Track destination table names so two streams never default to the same
	// table. reserveTableName returns base, or base_1/base_2/... if taken.
	usedTableNames := map[string]bool{}
	reserveTableName := func(base string) string {
		name := base
		for i := 1; usedTableNames[name]; i++ {
			name = fmt.Sprintf("%s_%d", base, i)
		}
		usedTableNames[name] = true
		return name
	}

	var topLevelIDs []string
	iter := firestoreClient.Collections(ctx)
	for {
		collection, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, err
		}
		topLevelIDs = append(topLevelIDs, collection.ID)
	}
	// Sort so table-name reservation (and any collision suffix) is deterministic
	// regardless of the order Collections() returns — avoids table-name drift
	// across rediscovers.
	sort.Strings(topLevelIDs)
	for _, id := range topLevelIDs {
		// Reserve top-level collections first (by their own ID) so any colliding
		// subcollection table names get the numeric suffix, not these.
		streams = append(streams, airbyte.Stream{
			Name:                    id,
			Namespace:               "firestore",
			TableNameTemplate:       reserveTableName(id),
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

	seenSubcollections := map[string]bool{}
	for _, path := range srcCfg.SubcollectionPaths {
		tokens := parseCollectionPath(path)
		// A single-token path is just a top-level collection, already covered
		// by the collection listing above — skip it.
		if len(tokens) < 2 {
			continue
		}
		// The stream name is the canonical path joined by "/". "/" can't appear
		// in a Firestore collection ID, so it both keeps distinct paths apart
		// (e.g. "users/orders_items" vs "users_orders/items") and can't collide
		// with a real top-level collection name. Dedupe equivalent configs
		// ("users/orders" and "users/*/orders" canonicalize to the same name).
		name := strings.Join(tokens, "/")
		if seenSubcollections[name] {
			continue
		}
		seenSubcollections[name] = true
		streams = append(streams, airbyte.Stream{
			Name:      name,
			Namespace: "firestore",
			// "/" is not a valid table-name character, so provide a clean
			// default table name. Underscores within tokens are stripped before
			// joining by "_" so distinct paths stay distinct as table names; a
			// numeric suffix is added if that name is already taken.
			TableNameTemplate: reserveTableName(subcollectionTableName(tokens)),
			// _path (full document path) is part of the key because a bare
			// document id is not unique across different parents in a
			// CollectionGroup result.
			SourceDefinedPrimaryKey: [][]string{{"id"}, {"_path"}},
			JSONSchema:              airbyte.Properties{},
			SupportedSyncModes: []airbyte.SyncMode{
				airbyte.SyncModeFullRefresh,
			},
			SourceDefinedCursor: false,
		})
	}

	return &airbyte.Catalog{Streams: streams}, nil
}

// parseCollectionPath splits a configured subcollection path into its chain of
// collection IDs. Empty segments and document-id placeholders ("*") are
// dropped, so "users/orders", "/users/orders/" and "users/*/orders" all yield
// ["users", "orders"].
func parseCollectionPath(path string) []string {
	tokens := make([]string, 0, 4)
	for _, t := range strings.Split(path, "/") {
		t = strings.TrimSpace(t)
		if t == "" || t == "*" {
			continue
		}
		tokens = append(tokens, t)
	}
	return tokens
}

// subcollectionTableName builds a default destination table name for a
// subcollection path. The "/" used in the stream name isn't a valid
// table-name character, so tokens are joined by "_". Underscores already
// present within tokens are stripped first, so paths that would otherwise
// collapse ("users/orders_items" and "users_orders/items" -> "users_orders_items")
// stay distinct ("users_ordersitems" vs "usersorders_items").
func subcollectionTableName(tokens []string) string {
	cleaned := make([]string, len(tokens))
	for i, t := range tokens {
		cleaned[i] = strings.ReplaceAll(t, "_", "")
	}
	return strings.Join(cleaned, "_")
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

	// Map each configured subcollection's stream name (canonical path joined by
	// "/") to its collection-ID chain, so streams selected in the
	// ConfiguredCatalog can be routed to the CollectionGroup loader. Matches the
	// naming done in Discover. Single-token paths are top-level collections and
	// are not treated as subcollections.
	subcollections := map[string][]string{}
	for _, path := range srcCfg.SubcollectionPaths {
		if tokens := parseCollectionPath(path); len(tokens) >= 2 {
			subcollections[strings.Join(tokens, "/")] = tokens
		}
	}

	for _, stream := range configuredCat.Streams {
		if err := tracker.StreamStatus(stream.Stream.Name, stream.Stream.Namespace, airbyte.StreamStatusStarted); err != nil {
			return err
		}
		var streamErr error
		if stream.Stream.Namespace == "auth" && stream.Stream.Name == "users" {
			streamErr = loadUsers(ctx, stream.Stream, authClient, tracker)
		} else if tokens, ok := subcollections[stream.Stream.Name]; ok {
			streamErr = loadCollectionGroup(ctx, stream.Stream, tokens, firestoreClient, tracker)
		} else if strings.Contains(stream.Stream.Name, "/") {
			// A "/" in the name marks a subcollection stream. If it isn't in the
			// current subcollectionPaths config, the catalog and source config
			// have drifted — treat it as a stream error rather than mistreat it
			// as a top-level collection (which would create a "/"-named ref).
			streamErr = fmt.Errorf("subcollection stream %q is selected but not present in the current source config (subcollectionPaths) — refresh the catalog", stream.Stream.Name)
		} else {
			streamErr = loadCollection(ctx, stream.Stream, firestoreClient, tracker)
		}
		if streamErr != nil {
			// Report the failure for this stream and keep syncing the rest: emit
			// a TRACE ERROR (which the sidecar attributes to this stream) and
			// mark the stream INCOMPLETE, instead of aborting the whole sync.
			_ = tracker.StreamError(stream.Stream.Name, stream.Stream.Namespace, streamErr.Error())
			_ = tracker.StreamStatus(stream.Stream.Name, stream.Stream.Namespace, airbyte.StreamStatusIncomplete)
			continue
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

// loadCollectionGroup syncs a subcollection identified by its full collection
// path (e.g. ["users", "orders"]). It runs a CollectionGroup query on the last
// token, which matches that subcollection under any parent — including
// non-existent ("phantom") parent documents that a top-level walk would miss.
// Because CollectionGroup matches by collection ID alone (not by full path),
// each returned document is filtered against the configured path so unrelated
// subcollections that happen to share the last token are excluded.
func loadCollectionGroup(ctx context.Context, stream airbyte.Stream, tokens []string, firestoreClient *firestore.Client, tracker airbyte.MessageTracker) error {
	groupID := tokens[len(tokens)-1]

	var lastDoc *firestore.DocumentSnapshot
	for {
		q := firestoreClient.CollectionGroup(groupID).OrderBy(firestore.DocumentID, firestore.Asc).Limit(batchSize)
		if lastDoc != nil {
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

			if !matchesCollectionPath(doc.Ref, tokens) {
				continue
			}
			data := doc.Data()
			if data == nil {
				continue
			}
			data = convertSpecificTypes(data)
			data["id"] = doc.Ref.ID
			// Always set "_path" to the full Firestore document path so it is a
			// deterministic component of the stream's primary key. If the source
			// document already has a "_path" field, relocate its original value
			// to the first free "_"-prefixed key ("__path", "___path", ...) so no
			// source field — including a pre-existing "__path" — is overwritten.
			if orig, ok := data["_path"]; ok {
				key := "__path"
				for {
					if _, exists := data[key]; !exists {
						break
					}
					key = "_" + key
				}
				data[key] = orig
			}
			data["_path"] = doc.Ref.Path

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

// matchesCollectionPath reports whether a document's ancestry is exactly the
// chain of collection IDs in tokens (e.g. ["users", "orders"] matches a doc at
// users/{uid}/orders/{oid}).
func matchesCollectionPath(ref *firestore.DocumentRef, tokens []string) bool {
	chain := collectionChain(ref)
	if len(chain) != len(tokens) {
		return false
	}
	for i := range tokens {
		if chain[i] != tokens[i] {
			return false
		}
	}
	return true
}

// collectionChain returns the ordered chain of collection IDs a document lives
// under, root-first. For a doc at users/{uid}/orders/{oid} it returns
// ["users", "orders"].
func collectionChain(ref *firestore.DocumentRef) []string {
	var chain []string
	for col := ref.Parent; col != nil; {
		chain = append([]string{col.ID}, chain...)
		if col.Parent == nil {
			break
		}
		col = col.Parent.Parent
	}
	return chain
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
