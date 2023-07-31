package integration_tests

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/jitsucom/jitsu/server/test"
	"github.com/jitsucom/jitsu/server/testsuit"
	"github.com/spf13/viper"
	"github.com/stretchr/testify/require"
)

//TestPostgresStreamInsert stores two events into postgres (without/with parsed ua and geo)
//tests full cycle of event processing
func TestPostgresStreamInsert(t *testing.T) {
	viper.Set("server.log.path", "")
	viper.Set("log.path", "")
	viper.Set("server.auth", `{"tokens":[{"id":"id1","client_secret":"c2stoken"}]}`)
	viper.Set("sql_debug_log.ddl.enabled", false)

	//create postgres
	ctx := context.Background()
	postgresContainer, err := test.NewPostgresContainer(ctx)
	if err != nil {
		t.Fatalf("failed to initialize container: %v", err)
	}
	defer postgresContainer.Close()

	configTemplate := `{"destinations": {
  			"test_postgres_store": {
        		"type": "postgres",
        		"mode": "stream",
				"only_tokens": ["c2stoken"],
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

	testSuite := testsuit.NewSuiteBuilder(t).WithGeoDataMock(nil).WithDestinationService(t, destinationConfig).Build(t)
	defer testSuite.Close()

	time.Sleep(100 * time.Millisecond)

	//** Requests **

	pageviewReqPayload := []byte(`{
  "event_type": "pageview",
  "event_id": "1",
  "user": "anonym1",
  "user_agent": "Mozilla/5.0",
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
}`)
	pageviewReq, err := http.NewRequest("POST", "http://"+testSuite.HTTPAuthority()+"/api/v1/event?token=c2stoken", bytes.NewBuffer(pageviewReqPayload))
	require.NoError(t, err)
	pageviewReq.Header.Add("x-forwarded-for", "10.10.10.10")
	resp, err := http.DefaultClient.Do(pageviewReq)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, resp.StatusCode, "HTTP code isn't 200")
	resp.Body.Close()
	time.Sleep(1 * time.Second)

	identifyReqPayload := []byte(`{
  "event_type": "identify",
  "event_id": "2",
  "user": "id1kk",
  "parsed_ua":{"ua_family": "Laptop"},
  "location": {"city": "Oldtown", "country": "Westeros"},
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
}`)
	identifyReq, err := http.NewRequest("POST", "http://"+testSuite.HTTPAuthority()+"/api/v1/event?token=c2stoken", bytes.NewBuffer(identifyReqPayload))
	require.NoError(t, err)
	identifyReq.Header.Add("x-forwarded-for", "10.10.10.10")
	resp, err = http.DefaultClient.Do(identifyReq)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, resp.StatusCode, "HTTP code isn't 200")
	resp.Body.Close()

	time.Sleep(2 * time.Second)

	objects, err := postgresContainer.GetSortedRows("events", "*", "", "order by utc_time")
	require.NoError(t, err, "Error selecting all events")
	require.Equal(t, 2, len(objects), "Rows count must be 2")

	expected := `[{"_timestamp":"2020-06-16T23:00:00Z","api_key":"c2stoken","doc_encoding":"UTF-8","doc_host":"jitsu.com","doc_path":"/","event_type":"pageview","eventn_ctx_event_id":"1","local_tz_offset":-180,"location_city":"New York","location_country":"US","location_latitude":79.01,"location_longitude":22.02,"location_zip":"14101","page_title":"Jitsu: Open-source data integration and event collection","parsed_ua_ua_family":"Go-http-client","parsed_ua_ua_version":"1.1","referer":"","screen_resolution":"1680x1050","source_ip":"10.10.10.10","url":"https://jitsu.com/","user":"anonym1","user_agent":"Go-http-client/1.1","user_language":"ru-RU","utc_time":"2020-12-23T17:55:54.9Z","vp_size":"1680x235"},{"_timestamp":"2020-06-16T23:00:00Z","api_key":"c2stoken","doc_encoding":"UTF-8","doc_host":"jitsu.com","doc_path":"/","event_type":"identify","eventn_ctx_event_id":"2","local_tz_offset":-180,"location_city":"Oldtown","location_country":"Westeros","location_latitude":79.01,"location_longitude":22.02,"location_zip":"14101","page_title":"Jitsu: Open-source data integration and event collection","parsed_ua_ua_family":"Laptop","parsed_ua_ua_version":null,"referer":"","screen_resolution":"1680x1050","source_ip":"10.10.10.10","url":"https://jitsu.com/","user":"id1kk","user_agent":"Go-http-client/1.1","user_language":"ru-RU","utc_time":"2020-12-24T17:55:54.9Z","vp_size":"1680x235"}]`
	actual, _ := json.Marshal(objects)

	require.Equal(t, expected, string(actual), "Objects in DWH and expected objects aren't equal")
}
