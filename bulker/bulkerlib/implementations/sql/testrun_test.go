package sql

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"slices"
	"strings"
	"testing"

	bulker "github.com/jitsucom/bulker/bulkerlib"
	"github.com/jitsucom/bulker/jitsubase/logging"
)

// This file makes the warehouse objects a test run touches unique to that run.
//
// Table names in this suite are derived from the test name, and the schema
// (dataset, on BigQuery) comes fixed from the destination secret. Two CI runs
// in flight at once therefore create, assert on and drop the *same* objects in
// the same cloud warehouse, and flake each other out. Setting
// BULKER_TEST_RUN_ID moves a run into schemas of its own.
//
// Local runs leave BULKER_TEST_RUN_ID empty and keep the historical names.

// testRunSchemaPrefix marks a schema as owned by a test run. Everything this
// file creates or drops starts with it.
const testRunSchemaPrefix = "bulker_ci_"

// maxTestRunIdLen keeps identifiers within the tightest limit we target
// (Redshift: 127 chars) — the longest name we build is
// prefix + id + "_" + namespace.
const maxTestRunIdLen = 40

var testRunIdUnsafeChars = regexp.MustCompile(`[^a-z0-9_]+`)

// testRunId is empty for local runs, which means "no isolation, use the names
// the destination config came with".
var testRunId = sanitizeTestRunId(os.Getenv("BULKER_TEST_RUN_ID"))

func sanitizeTestRunId(raw string) string {
	id := strings.Trim(testRunIdUnsafeChars.ReplaceAllString(strings.ToLower(raw), "_"), "_")
	if len(id) > maxTestRunIdLen {
		id = strings.Trim(id[:maxTestRunIdLen], "_")
	}
	if id == "" {
		return ""
	}
	// Unquoted identifiers can't start with a digit, and GitHub run ids are all digits.
	if id[0] >= '0' && id[0] <= '9' {
		id = "r" + id
	}
	return id
}

// testRunSchema is the schema this run owns, and the only prefix
// dropTestSchema will ever delete. Empty when isolation is off.
func testRunSchema() string {
	if testRunId == "" {
		return ""
	}
	return testRunSchemaPrefix + testRunId
}

// testNamespaces lists every namespace the suite asks for explicitly, on top of
// each destination's default one. Cleanup runs in a separate process from the
// tests, so this has to be a static list rather than something tests register
// as they go; testNamespace panics on anything missing from it so the two
// cannot drift apart.
var testNamespaces = []string{"bnsp", "mynamespace", "mynamespace2", "mynsp3"}

// testNamespace maps a namespace a test asks for onto the one it should
// actually use for this run.
func testNamespace(name string) string {
	if !slices.Contains(testNamespaces, name) {
		panic(fmt.Sprintf("namespace %q is missing from testNamespaces in testrun_test.go — add it there, otherwise CI won't clean it up", name))
	}
	if testRunId == "" {
		return name
	}
	return testRunSchema() + "_" + name
}

// originalConfigs keeps the pre-rewrite config of each cloud destination, whose
// schema is the one from the secret and so is known to exist. Isolation needs a
// connection that doesn't depend on the run's own schema twice: to create that
// schema before any test opens a bulker, and to drop it afterwards.
var originalConfigs = map[string]string{}

// withTestSchema points a raw destination config at this run's own schema.
// schemaKey is that config's schema field: "bqDataset" for BigQuery,
// "defaultSchema" for everything else.
func withTestSchema(configId string, configJson string, schemaKey string) string {
	if testRunId == "" || configJson == "" {
		return configJson
	}
	originalConfigs[configId] = configJson
	return withSchema(configJson, schemaKey, testRunSchema())
}

// schemaCreator reuses each adapter's own create-schema helper, which isn't on
// the SQLAdapter interface because production only ever creates a schema as a
// side effect of writing to it. BigQuery isn't one of these and is handled apart.
type schemaCreator interface {
	createSchemaIfNotExists(ctx context.Context, schema string) error
}

// ensureTestRunSchemas creates all of the run's schemas on every cloud
// destination before any test opens a bulker against them. Two reasons it can't
// be left to the adapters' create-on-demand:
//
//   - Snowflake pins the schema at connection time and refuses to connect to
//     one that doesn't exist, so the bulker can't be what creates it.
//   - The schemas are brand new every run, so the first wave of parallel tests
//     would otherwise all race to create the same one. On BigQuery that means
//     409s and a "too many dataset metadata update operations" rate limit;
//     before isolation the dataset already existed and nothing ever created it.
func ensureTestRunSchemas() {
	ctx := context.Background()
	schemas := testRunSchemas()
	for configId, configJson := range originalConfigs {
		testConfig := configRegistry[configId]
		blk, err := bulker.CreateBulker(bulker.Config{Id: "prepare_" + configId, BulkerType: testConfig.BulkerType, DestinationConfig: configJson})
		if err != nil {
			panic(fmt.Errorf("%s: failed to connect to create test run schemas: %v", configId, err))
		}
		adapter, ok := blk.(SQLAdapter)
		if !ok {
			_ = blk.Close()
			panic(fmt.Errorf("%s: not a SQLAdapter, cannot create test run schemas", configId))
		}
		for _, schema := range schemas {
			if err := createTestSchema(ctx, adapter, schema); err != nil {
				_ = blk.Close()
				panic(fmt.Errorf("%s: failed to create test run schema %s: %v", configId, schema, err))
			}
		}
		_ = blk.Close()
		logging.Infof("%s: created test run schemas %v", configId, schemas)
	}
}

func createTestSchema(ctx context.Context, adapter SQLAdapter, schema string) error {
	switch a := adapter.(type) {
	case *BigQuery:
		return a.createDatasetIfNotExists(ctx, schema)
	default:
		creator, ok := adapter.(schemaCreator)
		if !ok {
			return fmt.Errorf("don't know how to create a schema on %s", adapter.Type())
		}
		return creator.createSchemaIfNotExists(ctx, schema)
	}
}

func withSchema(configJson string, schemaKey string, schema string) string {
	var config map[string]any
	if err := json.Unmarshal([]byte(configJson), &config); err != nil {
		panic(fmt.Errorf("BULKER_TEST_RUN_ID is set, but a destination config is not valid JSON: %v", err))
	}
	config[schemaKey] = schema
	patched, err := json.Marshal(config)
	if err != nil {
		panic(err)
	}
	return string(patched)
}

// ownedByTestRun reports whether a schema was created by this run, and may
// therefore be dropped. Without a run id nothing is owned — the only schemas
// around are the shared ones the destination config came with.
func ownedByTestRun(runSchema string, schema string) bool {
	// Not HasPrefix: run "…_r1" must not claim run "…_r12"'s schemas.
	return runSchema != "" && (schema == runSchema || strings.HasPrefix(schema, runSchema+"_"))
}

// parseRequestedConfigs reads the comma-separated destination list a CI shard
// asks for via BULKER_TEST_CONFIGS. Empty means "everything with credentials".
func parseRequestedConfigs(raw string) []string {
	configs := make([]string, 0)
	for _, configId := range strings.Split(raw, ",") {
		if configId = strings.TrimSpace(configId); configId != "" {
			configs = append(configs, configId)
		}
	}
	return configs
}

// sqlExecutor is satisfied by every SQLAdapterBase-backed adapter in this
// package. DROP SCHEMA isn't on the SQLAdapter interface because nothing in
// production needs it, so cleanup reaches for the underlying connection.
// BigQuery is the exception — it isn't SQLAdapterBase-backed and is handled
// on its own below.
type sqlExecutor interface {
	txOrDb(ctx context.Context) TxOrDB
}

func TestSanitizeTestRunId(t *testing.T) {
	for _, tt := range []struct{ raw, expected string }{
		{"", ""},
		{"---", ""},
		// GitHub run ids are all digits, and an unquoted identifier can't start with one.
		{"31800631540_1", "r31800631540_1"},
		{"Ildar/JITSU-164", "ildar_jitsu_164"},
		{strings.Repeat("a", maxTestRunIdLen+10), strings.Repeat("a", maxTestRunIdLen)},
		// Truncation must not leave a trailing separator.
		{strings.Repeat("a", maxTestRunIdLen-1) + "-b", strings.Repeat("a", maxTestRunIdLen-1)},
	} {
		if got := sanitizeTestRunId(tt.raw); got != tt.expected {
			t.Errorf("sanitizeTestRunId(%q) = %q, expected %q", tt.raw, got, tt.expected)
		}
	}
}

func TestOwnedByTestRun(t *testing.T) {
	for _, tt := range []struct {
		runSchema, schema string
		expected          bool
	}{
		// No run id: nothing is owned, so nothing may be dropped.
		{"", "public", false},
		{"", "bulker_ci_r1", false},
		{"bulker_ci_r1", "bulker_ci_r1", true},
		{"bulker_ci_r1", "bulker_ci_r1_mynamespace", true},
		{"bulker_ci_r1", "bulker_ci_r2", false},
		// A longer run id is a different run, not a namespace of this one.
		{"bulker_ci_r1", "bulker_ci_r12", false},
		{"bulker_ci_r1", "bulker_ci_r12_mynamespace", false},
		{"bulker_ci_r1", "public", false},
		{"bulker_ci_r1", "bulker", false},
	} {
		if got := ownedByTestRun(tt.runSchema, tt.schema); got != tt.expected {
			t.Errorf("ownedByTestRun(%q, %q) = %v, expected %v", tt.runSchema, tt.schema, got, tt.expected)
		}
	}
}

func TestWithSchema(t *testing.T) {
	// The schema key is overwritten whether or not the config already carries one.
	for _, configJson := range []string{`{"project":"p"}`, `{"project":"p","bqDataset":"shared"}`} {
		patched := withSchema(configJson, "bqDataset", "bulker_ci_r1")
		var config map[string]any
		if err := json.Unmarshal([]byte(patched), &config); err != nil {
			t.Fatalf("withSchema produced invalid JSON: %v", err)
		}
		if config["bqDataset"] != "bulker_ci_r1" {
			t.Errorf("withSchema(%s) left bqDataset as %v", configJson, config["bqDataset"])
		}
		if config["project"] != "p" {
			t.Errorf("withSchema(%s) dropped unrelated key project", configJson)
		}
	}
}

func TestParseRequestedConfigs(t *testing.T) {
	if got := parseRequestedConfigs(""); len(got) != 0 {
		t.Errorf("parseRequestedConfigs(\"\") = %v, expected empty", got)
	}
	got := parseRequestedConfigs(" postgres, clickhouse_cluster ,,")
	if !slices.Equal(got, []string{"postgres", "clickhouse_cluster"}) {
		t.Errorf("parseRequestedConfigs = %v", got)
	}
}

// TestCleanupTestRun drops the schemas this run created. CI runs it as its own
// always() step rather than as suite teardown, so that it also fires when the
// job is cancelled — which, with cancel-in-progress, is what happens on every
// re-push.
func TestCleanupTestRun(t *testing.T) {
	if os.Getenv("BULKER_TEST_CLEANUP") == "" {
		t.Skip("cleanup step only: set BULKER_TEST_CLEANUP to drop this run's schemas")
	}
	if testRunId == "" {
		t.Fatal("BULKER_TEST_CLEANUP needs BULKER_TEST_RUN_ID: without it the run owns no schema, and the only schemas around are shared ones")
	}
	schemas := testRunSchemas()
	ctx := context.Background()
	// originalConfigs holds exactly the cloud destinations — the container-backed
	// ones take their state to the grave with the container, and MySQL and
	// ClickHouse don't speak DROP SCHEMA anyway. Connecting with the original
	// config rather than the rewritten one means cleanup doesn't depend on the
	// schema it is about to drop still being there.
	for configId, configJson := range originalConfigs {
		testConfig := configRegistry[configId]
		blk, err := bulker.CreateBulker(bulker.Config{Id: "cleanup_" + configId, BulkerType: testConfig.BulkerType, DestinationConfig: configJson})
		if err != nil {
			t.Errorf("%s: failed to create bulker for cleanup: %v", configId, err)
			continue
		}
		adapter, ok := blk.(SQLAdapter)
		if !ok {
			_ = blk.Close()
			t.Errorf("%s: not a SQLAdapter, cannot clean up", configId)
			continue
		}
		for _, schema := range schemas {
			if err := dropTestSchema(ctx, adapter, schema); err != nil {
				// Report but keep going: a leaked schema on one destination
				// shouldn't stop the others from being cleaned.
				t.Errorf("%s: failed to drop schema %s: %v", configId, schema, err)
			} else {
				logging.Infof("%s: dropped schema %s", configId, schema)
			}
		}
		_ = blk.Close()
	}
}

// testRunSchemas is every schema this run owns: its default one plus one per
// namespace the suite asks for. Setup creates them, cleanup drops them.
func testRunSchemas() []string {
	schemas := make([]string, 0, len(testNamespaces)+1)
	schemas = append(schemas, testRunSchema())
	for _, name := range testNamespaces {
		schemas = append(schemas, testNamespace(name))
	}
	return schemas
}

func dropTestSchema(ctx context.Context, adapter SQLAdapter, schema string) error {
	// Belt and braces: cleanup must not be able to drop a schema this run
	// doesn't own, whatever it is handed.
	if !ownedByTestRun(testRunSchema(), schema) {
		return fmt.Errorf("refusing to drop %q: not a schema owned by this test run", schema)
	}
	switch a := adapter.(type) {
	case *BigQuery:
		if err := a.client.Dataset(a.NamespaceName(schema)).DeleteWithContents(ctx); err != nil && !isNotFoundErr(err) {
			return err
		}
		return nil
	case *Snowflake:
		// Snowflake's own CREATE SCHEMA passes NamespaceName unquoted; match it.
		_, err := a.txOrDb(ctx).ExecContext(ctx, fmt.Sprintf(`DROP SCHEMA IF EXISTS %s CASCADE`, a.NamespaceName(schema)))
		return err
	default:
		executor, ok := adapter.(sqlExecutor)
		if !ok {
			return fmt.Errorf("don't know how to drop a schema on %s", adapter.Type())
		}
		_, err := executor.txOrDb(ctx).ExecContext(ctx, fmt.Sprintf(`DROP SCHEMA IF EXISTS "%s" CASCADE`, adapter.NamespaceName(schema)))
		return err
	}
}
