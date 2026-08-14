package app

import (
	"bufio"
	"bytes"
	"context"
	_ "embed"
	"fmt"
	"github.com/jitsucom/bulker/bulkerapp/app/testcontainers/kafka"
	_ "github.com/jitsucom/bulker/bulkerlib/implementations/sql"
	"github.com/jitsucom/bulker/bulkerlib/implementations/sql/testcontainers"
	"github.com/jitsucom/bulker/jitsubase/appbase"
	"github.com/jitsucom/bulker/jitsubase/logging"
	"github.com/stretchr/testify/require"
	"io"
	"net/http"
	"os"
	"path"
	"strings"
	"sync"
	"testing"
	"time"
)

const testBulkerPort = "33042"
const testBulkerURL = "http://localhost:" + testBulkerPort

type StepFunction func() error

type AppTestConfig struct {
	name                       string
	destinationId              string
	eventsFile                 string
	token                      string
	mode                       string
	expectedRowsCount          int
	expectedDeadCount          int
	waitAfterAllMessageSentSec int
	loadTestEvents             int
	//map of expected errors by step name. May be error type or string. String is used for error message partial matching.
	expectedErrors map[string]any
	//map of function to run after each step by step name.
	postStepFunctions map[string]StepFunction
}

//go:embed test_data/config.yaml
var testConfigSource string

//go:embed test_data/bulker.env
var testBulkerEnv string

// Postgres and Kafka are shared by every test in this package rather than
// started per test. Kafka can't be per-test anyway — its compose stack has a
// fixed id, fixed container names and a fixed host port, and it tears down any
// existing stack on the way up — and starting the pair three times was the
// largest single cost in bulkerapp's runtime.
//
// The price is that the tests are no longer isolated from each other: they run
// serially and must keep using distinct table names, or they will count each
// other's rows in Postgres and share topics in Kafka, which are derived from
// the destination and table name. For the same reason the package no longer
// survives -count=2: a second pass finds the tables already populated.
var (
	sharedContainersOnce sync.Once
	sharedPostgres       *testcontainers.PostgresContainer
	sharedKafka          *kafka.KafkaContainer
	sharedContainersErr  error
)

func sharedContainers(t *testing.T) *testcontainers.PostgresContainer {
	sharedContainersOnce.Do(func() {
		sharedPostgres, sharedContainersErr = testcontainers.NewPostgresContainer(context.Background())
		if sharedContainersErr != nil {
			sharedContainersErr = fmt.Errorf("could not start postgres container: %v", sharedContainersErr)
			return
		}
		sharedKafka, sharedContainersErr = kafka.NewKafkaContainer(context.Background())
		if sharedContainersErr != nil {
			sharedContainersErr = fmt.Errorf("could not start kafka container: %v", sharedContainersErr)
		}
	})
	if sharedContainersErr != nil {
		t.Fatalf("%v", sharedContainersErr)
	}
	return sharedPostgres
}

// TestMain tears the shared containers down once everything has run. They start
// lazily, so a run that only touches this package's unit tests never pays for
// them.
func TestMain(m *testing.M) {
	os.Exit(runTests(m))
}

// runTests exists so the containers are closed by a defer: os.Exit in TestMain
// skips defers, and a panic out of m.Run() would otherwise leak a Postgres
// holding a fixed host port and a Kafka compose stack holding a fixed id —
// enough to break the next run on a reused runner.
func runTests(m *testing.M) int {
	defer func() {
		if sharedPostgres != nil {
			_ = sharedPostgres.Close()
		}
		if sharedKafka != nil {
			_ = sharedKafka.Close()
		}
	}()
	return m.Run()
}

func initApp(t *testing.T, envVars map[string]string) (app *appbase.App[Config], postgresContainer *testcontainers.PostgresContainer) {
	postgresContainer = sharedContainers(t)
	dir := t.TempDir()
	cfg := strings.ReplaceAll(testConfigSource, "[[POSTGRES_PORT]]", fmt.Sprint(postgresContainer.Port))
	err := os.WriteFile(path.Join(dir, "config.yaml"), []byte(cfg), 0644)
	if err != nil {
		t.Fatalf("could not write config.yaml to temp file: %v", err)
	}
	env := strings.ReplaceAll(testBulkerEnv, "[[CONFIG_SOURCE]]", path.Join(dir, "config.yaml"))
	err = os.WriteFile(path.Join(dir, "bulker.env"), []byte(env), 0644)
	if err != nil {
		t.Fatalf("could not write bulker.env to temp file: %v", err)
	}
	t.Setenv("HTTP_PORT", testBulkerPort)
	t.Setenv("BULKER_CONFIG_PATH", dir)
	for k, v := range envVars {
		t.Setenv(k, v)
	}
	settings := &appbase.AppSettings{
		ConfigPath: os.Getenv("BULKER_CONFIG_PATH"),
		Name:       "bulker",
		EnvPrefix:  "BULKER",
		ConfigName: "bulker",
		ConfigType: "env",
	}
	app = appbase.NewApp[Config](&Context{}, settings)
	go func() {
		app.Run()
	}()
	ready := false
	//wait in loop for server readiness
	for i := 0; i < 240; i++ {
		res, err := http.Get(testBulkerURL + "/ready")
		if err == nil && res.StatusCode == 200 {
			ready = true
			logging.Infof("bulker is ready")
			break
		}
		time.Sleep(1000 * time.Millisecond)
	}
	if !ready {
		t.Fatalf("bulker is not ready")
	}
	return
}

// Test streams in autocommit and bath mode. Both with good batches and batches with primary key violation error
func TestGoodAndBadStreams(t *testing.T) {
	app, postgresContainer := initApp(t, map[string]string{"BULKER_MESSAGES_RETRY_COUNT": "0",
		"BULKER_TOPIC_MANAGER_REFRESH_PERIOD_SEC": "1",
		"BULKER_BATCH_RUNNER_DEFAULT_PERIOD_SEC":  "1"})
	t.Cleanup(func() {
		// Only the app is per-test; the containers are shared and torn down in TestMain.
		app.Exit(appbase.SIG_SHUTDOWN_FOR_TESTS)
		time.Sleep(5 * time.Second)
	})

	tests := []AppTestConfig{
		{
			name:                       "good_batch",
			destinationId:              "batch_postgres",
			eventsFile:                 "test_data/goodbatch.ndjson",
			token:                      "21a2ae36-32994870a9fbf2f61ea6f6c8",
			waitAfterAllMessageSentSec: 10,
			expectedRowsCount:          30,
			expectedDeadCount:          0,
			mode:                       "batch",
		},
		{
			name:                       "bad_batch",
			destinationId:              "batch_postgres",
			eventsFile:                 "test_data/badbatch.ndjson",
			token:                      "21a2ae36-32994870a9fbf2f61ea6f6c8",
			waitAfterAllMessageSentSec: 10,
			expectedRowsCount:          20,
			expectedDeadCount:          10,
			mode:                       "batch",
		},
		{
			name:                       "good_stream",
			destinationId:              "stream_postgres",
			eventsFile:                 "test_data/goodbatch.ndjson",
			token:                      "21a2ae36-32994870a9fbf2f61ea6f6c8",
			waitAfterAllMessageSentSec: 10,
			expectedRowsCount:          30,
			expectedDeadCount:          0,
			mode:                       "stream",
		},
		{
			name:                       "bad_stream",
			destinationId:              "stream_postgres",
			eventsFile:                 "test_data/badbatch.ndjson",
			token:                      "21a2ae36-32994870a9fbf2f61ea6f6c8",
			waitAfterAllMessageSentSec: 10,
			expectedRowsCount:          29,
			expectedDeadCount:          1,
			mode:                       "stream",
		},
		{
			name:                       "invalid_token",
			destinationId:              "stream_postgres",
			eventsFile:                 "test_data/single.ndjson",
			waitAfterAllMessageSentSec: 0,
			token:                      "badtoken",
			expectedErrors: map[string]any{
				"count_rows":       "relation \"bulker.invalid_token\" does not exist",
				"send_object_0":    "unexpected status code: 401",
				"check_dead_topic": "unexpected status code: 401",
			},
			expectedRowsCount: 0,
			expectedDeadCount: 0,
			mode:              "stream",
		},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			integrationTest(t, tt, postgresContainer)
		})
	}
}

func TestBatchSizeBytes(t *testing.T) {
	app, postgresContainer := initApp(t, map[string]string{"BULKER_MESSAGES_RETRY_COUNT": "0",
		"BULKER_TOPIC_MANAGER_REFRESH_PERIOD_SEC": "1",
		"BULKER_BATCH_RUNNER_DEFAULT_PERIOD_SEC":  "1"})
	t.Cleanup(func() {
		// Only the app is per-test; the containers are shared and torn down in TestMain.
		app.Exit(appbase.SIG_SHUTDOWN_FOR_TESTS)
		time.Sleep(5 * time.Second)
	})

	tests := []AppTestConfig{
		{
			name:                       "good_batch_bytes",
			destinationId:              "batch_postgres_bytes",
			eventsFile:                 "test_data/goodbatch.ndjson",
			token:                      "21a2ae36-32994870a9fbf2f61ea6f6c8",
			waitAfterAllMessageSentSec: 10,
			expectedRowsCount:          30,
			expectedDeadCount:          0,
			mode:                       "batch",
		},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			integrationTest(t, tt, postgresContainer)
		})
	}
}

// Test that retry consumer works.
//
// The table names here have to differ from every other test's: Postgres and
// Kafka are shared across the package, so reusing TestGoodAndBadStreams'
// good_batch/good_stream would count its rows and replay its topics.
func TestEventsRetry(t *testing.T) {
	app, postgresContainer := initApp(t, map[string]string{"BULKER_MESSAGES_RETRY_COUNT": "20",
		"BULKER_BATCH_RUNNER_DEFAULT_RETRY_PERIOD_SEC":     "5",
		"BULKER_BATCH_RUNNER_DEFAULT_RETRY_BATCH_FRACTION": "1",
		"BULKER_RETRY_CONSUMER_BATCH_SIZE":                 "1",
		"BULKER_MESSAGES_RETRY_BACKOFF_BASE":               "0",
		"BULKER_TOPIC_MANAGER_REFRESH_PERIOD_SEC":          "1",
		"BULKER_BATCH_RUNNER_DEFAULT_PERIOD_SEC":           "1"})
	t.Cleanup(func() {
		// Only the app is per-test; the containers are shared and torn down in TestMain.
		app.Exit(appbase.SIG_SHUTDOWN_FOR_TESTS)
		time.Sleep(5 * time.Second)
	})
	t.Cleanup(func() {
		// This test stops Postgres mid-run and restarts it a few steps later. A
		// failed assertion in between calls FailNow, so that restart can be
		// skipped — and the container is shared now, so it would stay down for
		// every test after this one and bury the original failure under
		// connection errors.
		_ = postgresContainer.Start()
	})
	tests := []AppTestConfig{
		{
			name:                       "retry_batch",
			destinationId:              "batch_postgres",
			eventsFile:                 "test_data/goodbatch.ndjson",
			token:                      "21a2ae36-32994870a9fbf2f61ea6f6c8",
			waitAfterAllMessageSentSec: 15,
			postStepFunctions: map[string]StepFunction{
				"send_object_9": func() error {
					time.Sleep(5 * time.Second)
					return postgresContainer.Stop()
				},
				"send_object_19": func() error {
					time.Sleep(10 * time.Second)
					return postgresContainer.Start()
				},
			},
			expectedRowsCount: 30,
			expectedDeadCount: 0,
			mode:              "batch",
		},
		{
			name:                       "retry_stream",
			destinationId:              "stream_postgres",
			eventsFile:                 "test_data/goodbatch.ndjson",
			token:                      "21a2ae36-32994870a9fbf2f61ea6f6c8",
			waitAfterAllMessageSentSec: 15,
			postStepFunctions: map[string]StepFunction{
				"send_object_9": func() error {
					time.Sleep(5 * time.Second)
					return postgresContainer.Stop()
				},
				"send_object_19": func() error {
					time.Sleep(10 * time.Second)
					return postgresContainer.Start()
				},
			},
			expectedRowsCount: 30,
			expectedDeadCount: 0,
			mode:              "stream",
		},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			integrationTest(t, tt, postgresContainer)
		})
	}
}

func integrationTest(t *testing.T, tt AppTestConfig, postgresContainer *testcontainers.PostgresContainer) {
	reqr := require.New(t)

	file, err := os.Open(tt.eventsFile)
	if err != nil {
		t.Fatalf("could not open file %s: %v", tt.eventsFile, err)
	}
	defer func() {
		_ = file.Close()
	}()
	scanner := bufio.NewScanner(file)
	i := 0
	for scanner.Scan() {
		req, _ := http.NewRequest("POST", fmt.Sprintf(testBulkerURL+"/post/%s?tableName=%s", tt.destinationId, tt.name), bytes.NewBuffer(scanner.Bytes()))
		req.Header.Set("Authorization", "Bearer "+tt.token)
		res, err := http.DefaultClient.Do(req)
		if err == nil {
			if res.StatusCode != 200 {
				err = fmt.Errorf("unexpected status code: %d", res.StatusCode)
			}
		}
		PostStep(fmt.Sprintf("send_object_%d", i), tt, reqr, err)
		if res != nil && res.Body != nil {
			resBody, err := io.ReadAll(res.Body)
			_ = res.Body.Close()
			PostStep(fmt.Sprintf("read_response_%d", i), tt, reqr, err)
			logging.Infof("response: %s", string(resBody))
		}
		i++
	}
	time.Sleep(time.Duration(tt.waitAfterAllMessageSentSec) * time.Second)
	rowsCount, err := postgresContainer.CountRows(fmt.Sprintf("%s.%s", postgresContainer.Schema, tt.name))
	PostStep("count_rows", tt, reqr, err)
	logging.Infof("rows count: %d", rowsCount)

	reqr.Equal(tt.expectedRowsCount, rowsCount, "unexpected rows count in table %s", tt.name)

	req, _ := http.NewRequest("GET", fmt.Sprintf(testBulkerURL+"/failed/%s?tableName=%s&status=dead&mode=%s", tt.destinationId, tt.name, tt.mode), nil)
	req.Header.Set("Authorization", "Bearer "+tt.token)
	res, err := http.DefaultClient.Do(req)
	if err == nil {
		if res.StatusCode != 200 {
			err = fmt.Errorf("unexpected status code: %d", res.StatusCode)
		}
	}
	PostStep("check_dead_topic", tt, reqr, err)
	deadCount := 0
	if res.StatusCode == 200 {
		scanner = bufio.NewScanner(res.Body)
		for scanner.Scan() {
			logging.Infof("dead: %s", scanner.Text())
			deadCount++
		}
	}
	if res != nil && res.Body != nil {
		_ = res.Body.Close()
	}
	reqr.Equal(tt.expectedDeadCount, deadCount, "unexpected dead count for table %s", tt.name)
	logging.Infof("Test %s passed", tt.name)
}

func PostStep(step string, testConfig AppTestConfig, reqr *require.Assertions, err error) {
	//run post step function if any
	stepF := testConfig.postStepFunctions[step]
	if stepF != nil {
		err1 := stepF()
		if err == nil {
			err = err1
		}
	}

	expectedError := testConfig.expectedErrors[step]
	switch target := expectedError.(type) {
	case string:
		reqr.Containsf(fmt.Sprintf("%v", err), target, "error in step %s doesn't contain expected value: %s", step, target)
	case error:
		reqr.ErrorIs(err, target, "error in step %s doesn't match expected error: %s", step, target)
	case nil:
		reqr.NoError(err, "unexpected error in step %s", step)
	default:
		panic(fmt.Sprintf("unexpected type of expected error: %T for step: %s", target, step))
	}
}
