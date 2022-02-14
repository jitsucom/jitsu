package integration_tests

import (
	"bytes"
	"context"
	"fmt"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/test"
	"github.com/jitsucom/jitsu/server/testsuit"
	"github.com/spf13/viper"
	"github.com/stretchr/testify/require"
	"net/http"
	"testing"
	"time"
)

type recogTestData = struct {
	testName    string
	eventIds    []string
	anonymousId string
	id          string
	userAgent   string
	expObjects  []map[string]interface{}
}

var recogTest = []recogTestData{
	{"Firefox", []string{"1", "2"}, "anonym1", "id1kk", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:97.0) Gecko/20100101 Firefox/97.0",
		[]map[string]interface{}{{"eventn_ctx_event_id": "1", "eventn_ctx_user_anonymous_id": "anonym1", "eventn_ctx_user_id": "id1kk"}, {"eventn_ctx_event_id": "2", "eventn_ctx_user_anonymous_id": "anonym1", "eventn_ctx_user_id": "id1kk"}}},
	//expect for event with eventn_ctx_event_id=3 from Google bot eventn_ctx_user_id still be null
	{"GoogleBot", []string{"3", "4"}, "anonym2", "id2kk", "Googlebot/2.1 (+http://www.google.com/bot.html)",
		[]map[string]interface{}{{"eventn_ctx_event_id": "3", "eventn_ctx_user_anonymous_id": "anonym2", "eventn_ctx_user_id": nil}, {"eventn_ctx_event_id": "4", "eventn_ctx_user_anonymous_id": "anonym2", "eventn_ctx_user_id": "id2kk"}}},
}

//

func TestPostgresRetroactiveUsersRecognition(t *testing.T) {
	viper.Set("server.log.path", "")
	viper.Set("log.path", "")
	viper.Set("server.auth", `{"tokens":[{"id":"id1","client_secret":"c2stoken_ur"}]}`)
	viper.Set("users_recognition.enabled", true)
	viper.Set("sql_debug_log.ddl.enabled", false)

	ctx := context.Background()

	//create redis
	redisContainer, err := test.NewRedisContainer(ctx)
	if err != nil {
		t.Fatalf("failed to initialize container: %v", err)
	}
	defer redisContainer.Close()

	//create postgres
	postgresContainer, err := test.NewPostgresContainer(ctx)
	if err != nil {
		t.Fatalf("failed to initialize container: %v", err)
	}
	defer postgresContainer.Close()

	viper.Set("meta.storage.redis.host", redisContainer.Host)
	viper.Set("meta.storage.redis.port", redisContainer.Port)

	configTemplate := `{"destinations": {
  			"test_postgres_user_recognition": {
        		"type": "postgres",
        		"mode": "stream",
				"only_tokens": ["c2stoken_ur"],
				"data_layout":{
                    "primary_key_fields":["eventn_ctx_event_id"],
                    "table_name_template": "recognition_events"
                },
        		"datasource": {
          			"host": "%s",
					"port": %d,
          			"db": "%s",
          			"schema": "%s",
          			"username": "%s",
          			"password": "%s",
					"parameters": {
						"sslmode": "disable"
					}
        		}
      		}
    	}}`

	destinationConfig := fmt.Sprintf(configTemplate, postgresContainer.Host, postgresContainer.Port, postgresContainer.Database, postgresContainer.Schema, postgresContainer.Username, postgresContainer.Password)

	testSuite := testsuit.NewSuiteBuilder(t).WithMetaStorage(t).WithDestinationService(t, destinationConfig).WithUserRecognition(t).Build(t)
	defer testSuite.Close()

	time.Sleep(100 * time.Millisecond)

	for _, testData := range recogTest {
		t.Run(testData.testName, func(t *testing.T) {
			logging.Infof("TestPostgresRetroactiveUsersRecognition with User-Agent: %s", testData.userAgent)
			//** Requests **
			//1. anonymous[anonym1] pageview
			//2. recognized[anonym1] identify

			pageviewReqPayload := []byte(`{
  "event_type": "pageview",
  "eventn_ctx": {
    "event_id": "` + testData.eventIds[0] + `",
    "user": {
      "anonymous_id": "` + testData.anonymousId + `"
    },
    "user_agent": "` + testData.userAgent + `",
    "utc_time": "2020-12-23T17:55:54.900000Z",
    "local_tz_offset": -180,
    "referer": "",
    "url": "https://jitsu.com/",
    "page_title": "Jitsu: Open-source data integration and event collection",
    "doc_path": "/",
    "doc_host": "jitsu.com",
    "screen_resolution": "1680x1050",
    "vp_size": "1680x235",
    "user_language": "ru-RU",
    "doc_encoding": "UTF-8",
    "utm": {},
    "click_id": {}
  }
}`)
			pageviewReq, err := http.NewRequest("POST", "http://"+testSuite.HTTPAuthority()+"/api/v1/event?token=c2stoken_ur", bytes.NewBuffer(pageviewReqPayload))
			pageviewReq.Header.Add("User-Agent", testData.userAgent)
			require.NoError(t, err)
			resp, err := http.DefaultClient.Do(pageviewReq)
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, resp.StatusCode, "HTTP code isn't 200")
			resp.Body.Close()
			time.Sleep(1 * time.Second)

			identifyReqPayload := []byte(`{
  "event_type": "identify",
  "eventn_ctx": {
    "event_id": "` + testData.eventIds[1] + `",
    "user": {
      "anonymous_id": "` + testData.anonymousId + `",
      "id": "` + testData.id + `"
    },
    "user_agent": "` + testData.userAgent + `",
    "utc_time": "2020-12-24T17:55:54.900000Z",
    "local_tz_offset": -180,
    "referer": "",
    "url": "https://jitsu.com/",
    "page_title": "Jitsu: Open-source data integration and event collection",
    "doc_path": "/",
    "doc_host": "jitsu.com",
    "screen_resolution": "1680x1050",
    "vp_size": "1680x235",
    "user_language": "ru-RU",
    "doc_encoding": "UTF-8",
    "utm": {},
    "click_id": {}
  }
}`)

			identifyReq, err := http.NewRequest("POST", "http://"+testSuite.HTTPAuthority()+"/api/v1/event?token=c2stoken_ur", bytes.NewBuffer(identifyReqPayload))
			identifyReq.Header.Add("User-Agent", testData.userAgent)

			require.NoError(t, err)
			resp, err = http.DefaultClient.Do(identifyReq)
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, resp.StatusCode, "HTTP code isn't 200")
			resp.Body.Close()

			time.Sleep(2 * time.Second)

			objects, err := postgresContainer.GetSortedRows("recognition_events", "eventn_ctx_event_id, eventn_ctx_user_anonymous_id, eventn_ctx_user_id", "eventn_ctx_user_anonymous_id='"+testData.anonymousId+"'", "order by eventn_ctx_utc_time")
			require.NoError(t, err, "Error selecting all events")

			require.Equal(t, testData.expObjects, objects, "Objects in DWH and expected objects aren't equal")
		})
	}
}
