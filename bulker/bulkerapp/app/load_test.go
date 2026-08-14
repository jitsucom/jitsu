package app

import (
	"bytes"
	_ "embed"
	"fmt"
	"github.com/google/uuid"
	_ "github.com/jitsucom/bulker/bulkerlib/implementations/sql"
	"github.com/jitsucom/bulker/bulkerlib/implementations/sql/testcontainers"
	"github.com/jitsucom/bulker/jitsubase/appbase"
	"github.com/jitsucom/bulker/jitsubase/logging"
	"github.com/stretchr/testify/require"
	"io"
	"net/http"
	"testing"
	"time"
)

// Test streams in autocommit and bath mode. Both with good batches and batches with primary key violation error
func _TestLoadTest(t *testing.T) {
	app, postgresContainer := initApp(t, map[string]string{"BULKER_MESSAGES_RETRY_COUNT": "0",
		"BULKER_TOPIC_MANAGER_REFRESH_PERIOD_SEC": "1",
		"BULKER_BATCH_RUNNER_DEFAULT_PERIOD_SEC":  "20"})
	t.Cleanup(func() {
		// Only the app is per-test; the containers are shared and torn down in TestMain.
		app.Exit(appbase.SIG_SHUTDOWN_FOR_TESTS)
		time.Sleep(5 * time.Second)
	})

	tests := []AppTestConfig{
		{
			name:                       "load_test",
			destinationId:              "load_test_postgres",
			token:                      "21a2ae36-32994870a9fbf2f61ea6f6c8",
			waitAfterAllMessageSentSec: 2,
			loadTestEvents:             1000000,
			expectedRowsCount:          1000000,
			expectedDeadCount:          0,
		},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			loadTest(t, tt, postgresContainer)
		})
	}
}

func loadTest(t *testing.T, tt AppTestConfig, postgresContainer *testcontainers.PostgresContainer) {
	reqr := require.New(t)

	for i := 0; i < tt.loadTestEvents; i++ {
		event := randomEvent()
		req, _ := http.NewRequest("POST", fmt.Sprintf(testBulkerURL+"/post/%s?tableName=%s", tt.destinationId, tt.name), bytes.NewBufferString(event))
		req.Header.Set("Authorization", "Bearer "+tt.token)
		res, err := http.DefaultClient.Do(req)
		if err == nil {
			if res.StatusCode != 200 {
				err = fmt.Errorf("unexpected status code: %d", res.StatusCode)
			}
		}
		//PostStep(fmt.Sprintf("send_object_%d", i), tt, reqr, err)
		if res != nil && res.Body != nil {
			_, err = io.ReadAll(res.Body)
			_ = res.Body.Close()
			reqr.Nil(err, "error reading response body")
			//PostStep(fmt.Sprintf("read_response_%d", i), tt, reqr, err)
			//logging.Infof("response: %s", string(resBody))
		}
	}
	var rowsCount int
	var err error
	for i := 0; i < 100; i++ {
		rowsCount, err = postgresContainer.CountRows(fmt.Sprintf("%s.%s", postgresContainer.Schema, tt.name))
		if rowsCount < 0 {
			reqr.Nil(err, "error getting rows count")
		}
		if rowsCount == tt.expectedRowsCount {
			break
		}
		if i%10 == 0 {
			logging.Infof("waiting for rows count %d/%d", rowsCount, tt.expectedRowsCount)
		}
		time.Sleep(1 * time.Second)
	}

	reqr.Equal(tt.expectedRowsCount, rowsCount, "unexpected rows count in table %s", tt.name)
	logging.Infof("Test %s passed", tt.name)
}

func randomEvent() string {
	anonId := uuid.NewString()
	messageId := uuid.NewString()
	receivedAt := time.Now().Format(time.RFC3339)
	return fmt.Sprintf(`{
  "anonymousId": "%s",
  "context": {
    "campaign": {},
    "ip": "204.113.62.220",
    "library": {
      "env": "browser",
      "name": "@jitsu/js",
      "version": "2.0.0"
    },
    "locale": "en-US",
    "page": {
      "encoding": "UTF-8",
      "host": "use.jitsu.com",
      "path": "/jitsu",
      "referrer": "https://use.jitsu.com",
      "referring_domain": "use.jitsu.com",
      "search": "",
      "title": "Jitsu : Jitsu",
      "url": "https://use.jitsu.com/jitsu"
    },
    "screen": {
      "density": 2,
      "height": 1296,
      "innerHeight": 1186,
      "innerWidth": 2304,
      "width": 2304
    },

    "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:126.0) Gecko/20100101 Firefox/126.0"
  },
  "messageId": "%s",
  "properties": {
    "hash": "",
    "height": 1186,
    "name": "Workspace Page",
    "path": "/jitsu",
    "referrer": "https://use.jitsu.com",
    "search": "",
    "title": "Jitsu : Jitsu",
    "url": "https://use.jitsu.com/jitsu",
    "width": 2304
  },
  "receivedAt": "%s",
  "requestIp": "204.113.62.220",
  "sentAt": "%s",
  "timestamp": "%s",
  "type": "page",
  "writeKey": null
}`, anonId, messageId, receivedAt, receivedAt, receivedAt)
}
