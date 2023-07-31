package integration_tests

import (
	"bytes"
	"io/ioutil"
	"net/http"
	"testing"
	"time"

	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/script/node"
	"github.com/jitsucom/jitsu/server/templates"

	"github.com/jitsucom/jitsu/server/testsuit"
	"github.com/spf13/viper"
	"github.com/stretchr/testify/require"
)

// TestMySQLStreamInsert stores two events into MySQL (without/with parsed ua and geo)
// tests full cycle of event processing
func TestSyncronousDestination(t *testing.T) {
	logging.LogLevel = logging.DEBUG
	nodeFactory, err := node.NewFactory(1, 20, 200, nil)
	if err != nil {
		t.Fatal(err)
	}

	templates.SetScriptFactory(nodeFactory)

	viper.Set("server.log.path", "")
	viper.Set("log.path", "")
	viper.Set("server.auth", `{"tokens":[{"id":"id1","client_secret":"c2stoken"}]}`)
	viper.Set("sql_debug_log.ddl.enabled", false)

	destinationConfig := `{"destinations": {
  			"tag_dst": {
        		"type": "tag",
				"only_tokens": ["c2stoken"],
				"config": {
				   "filter": "$.event_type == \"pageview\"",
				   "tagid": "123",
				   "template": "<script>alert(\"Hello {{ .user }} from Jitsu!\")</script>"
                }
           }
    	}}`

	testSuite := testsuit.NewSuiteBuilder(t).WithGeoDataMock(nil).WithDestinationService(t, destinationConfig).Build(t)
	defer testSuite.Close()

	// for RELIABILITY
	time.Sleep(2 * time.Second)

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
	b, err := ioutil.ReadAll(resp.Body)
	resp.Body.Close()
	require.NoError(t, err)
	logging.Infof("Response: %s", string(b))
	require.Equal(t, "{\"status\":\"ok\",\"jitsu_sdk_extras\":[{\"id\":\"123\",\"type\":\"tag\",\"value\":\"\\u003cscript\\u003ealert(\\\"Hello anonym1 from Jitsu!\\\")\\u003c/script\\u003e\"}]}",
		string(b))

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
	b, err = ioutil.ReadAll(resp.Body)
	resp.Body.Close()
	require.NoError(t, err)
	logging.Infof("Response: %s", string(b))
	require.Equal(t, "{\"status\":\"ok\"}",
		string(b))

}
