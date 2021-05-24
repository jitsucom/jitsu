package integration_tests

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"bou.ke/monkey"
	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/caching"
	"github.com/jitsucom/jitsu/server/coordination"
	"github.com/jitsucom/jitsu/server/destinations"
	"github.com/jitsucom/jitsu/server/enrichment"
	"github.com/jitsucom/jitsu/server/fallback"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	"github.com/jitsucom/jitsu/server/middleware"
	"github.com/jitsucom/jitsu/server/routers"
	"github.com/jitsucom/jitsu/server/sources"
	"github.com/jitsucom/jitsu/server/storages"
	"github.com/jitsucom/jitsu/server/synchronization"
	"github.com/jitsucom/jitsu/server/telemetry"
	"github.com/jitsucom/jitsu/server/test"
	"github.com/jitsucom/jitsu/server/users"
	"github.com/spf13/viper"
	"github.com/stretchr/testify/require"
)

func TestRetrospectiveUsersRecognition(t *testing.T) {
	viper.Set("server.log.path", "")

	freezeTime := time.Date(2020, 06, 16, 23, 0, 0, 0, time.UTC)
	patch := monkey.Patch(time.Now, func() time.Time { return freezeTime })
	defer patch.Unpatch()

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

	configTemplate := `{"destinations": {
  			"test_postgres_user_recognition": {
        		"type": "postgres",
        		"mode": "stream",
				"only_tokens": ["c2stoken"],
				"data_layout":{
                    "primary_key_fields":["eventn_ctx_event_id"]
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

	telemetry.InitTest()
	viper.Set("log.path", "")
	viper.Set("server.auth", `{"tokens":[{"id":"id1","client_secret":"c2stoken"}]}`)
	viper.Set("meta.storage.redis.host", redisContainer.Host)
	viper.Set("meta.storage.redis.port", redisContainer.Port)
	viper.Set("users_recognition.enabled", true)

	destinationConfig := fmt.Sprintf(configTemplate, postgresContainer.Host, postgresContainer.Port, postgresContainer.Database, postgresContainer.Schema, postgresContainer.Username, postgresContainer.Password)

	httpAuthority, _ := test.GetLocalAuthority()
	err = appconfig.Init(false, "")
	require.NoError(t, err)
	defer appconfig.Instance.Close()
	defer appconfig.Instance.CloseEventsConsumers()

	enrichment.InitDefault(
		viper.GetString("server.fields_configuration.src_source_ip"),
		viper.GetString("server.fields_configuration.dst_source_ip"),
		viper.GetString("server.fields_configuration.src_ua"),
		viper.GetString("server.fields_configuration.dst_ua"),
	)

	monitor := coordination.NewInMemoryService([]string{})

	metaStorage, err := meta.NewStorage(viper.Sub("meta.storage"))
	require.NoError(t, err)

	eventsCache := caching.NewEventsCache(metaStorage, 100)

	// ** Retrospective users recognition
	globalRecognitionConfiguration := &storages.UsersRecognition{
		Enabled:             viper.GetBool("users_recognition.enabled"),
		AnonymousIDNode:     viper.GetString("users_recognition.anonymous_id_node"),
		IdentificationNodes: viper.GetStringSlice("users_recognition.identification_nodes"),
		UserIDNode:          viper.GetString("users_recognition.user_id_node"),
	}

	if err := globalRecognitionConfiguration.Validate(); err != nil {
		logging.Fatalf("Invalid global users recognition configuration: %v", err)
	}

	loggerFactory := logging.NewFactory("/tmp", 5, false, nil, nil)
	destinationsFactory := storages.NewFactory(ctx, "/tmp", monitor, eventsCache, loggerFactory, globalRecognitionConfiguration, metaStorage, 0)
	destinationService, err := destinations.NewService(nil, destinationConfig, destinationsFactory, loggerFactory, false)
	require.NoError(t, err)
	appconfig.Instance.ScheduleClosing(destinationService)

	usersRecognitionService, err := users.NewRecognitionService(metaStorage, destinationService, globalRecognitionConfiguration, "/tmp")
	require.NoError(t, err)
	appconfig.Instance.ScheduleClosing(usersRecognitionService)

	router := routers.SetupRouter("", metaStorage, destinationService, sources.NewTestService(), synchronization.NewTestTaskService(),
		usersRecognitionService, fallback.NewTestService(), coordination.NewInMemoryService([]string{}), eventsCache)

	server := &http.Server{
		Addr:              httpAuthority,
		Handler:           middleware.Cors(router, appconfig.Instance.AuthorizationService.GetClientOrigins),
		ReadTimeout:       time.Second * 60,
		ReadHeaderTimeout: time.Second * 60,
		IdleTimeout:       time.Second * 65,
	}
	go func() {
		logging.Fatal(server.ListenAndServe())
	}()

	logging.Info("Started listen and serve " + httpAuthority)

	_, err = test.RenewGet("http://" + httpAuthority + "/ping")
	require.NoError(t, err)

	time.Sleep(100 * time.Millisecond)

	//** Requests **
	//1. anonymous[anonym1] pageview
	//2. recognized[anonym1] identify

	pageviewReqPayload := []byte(`{
  "event_type": "pageview",
  "eventn_ctx": {
    "event_id": "1",
    "user": {
      "anonymous_id": "anonym1"
    },
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
  }
}`)
	pageviewReq, err := http.NewRequest("POST", "http://"+httpAuthority+"/api/v1/event?token=c2stoken", bytes.NewBuffer(pageviewReqPayload))
	require.NoError(t, err)
	resp, err := http.DefaultClient.Do(pageviewReq)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, resp.StatusCode, "HTTP code isn't 200")
	resp.Body.Close()
	time.Sleep(1 * time.Second)

	identifyReqPayload := []byte(`{
  "event_type": "identify",
  "eventn_ctx": {
    "event_id": "2",
    "user": {
      "anonymous_id": "anonym1",
      "internal_id": "id1kk"
    },
    "user_agent": "Mozilla/5.0",
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
	identifyReq, err := http.NewRequest("POST", "http://"+httpAuthority+"/api/v1/event?token=c2stoken", bytes.NewBuffer(identifyReqPayload))
	require.NoError(t, err)
	resp, err = http.DefaultClient.Do(identifyReq)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, resp.StatusCode, "HTTP code isn't 200")
	resp.Body.Close()

	time.Sleep(2 * time.Second)

	objects, err := postgresContainer.GetAllSortedRows("events", "order by eventn_ctx_utc_time")
	require.Equal(t, 2, len(objects), "Rows count must be 2")

	expected := `[{"_timestamp":"2020-06-16T23:00:00Z","api_key":"c2stoken","event_type":"pageview","eventn_ctx_doc_encoding":"UTF-8","eventn_ctx_doc_host":"jitsu.com","eventn_ctx_doc_path":"/","eventn_ctx_event_id":"1","eventn_ctx_local_tz_offset":-180,"eventn_ctx_page_title":"Jitsu: Open-source data integration and event collection","eventn_ctx_parsed_ua_ua_family":"Go-http-client","eventn_ctx_parsed_ua_ua_version":"1.1","eventn_ctx_referer":"","eventn_ctx_screen_resolution":"1680x1050","eventn_ctx_url":"https://jitsu.com/","eventn_ctx_user_agent":"Go-http-client/1.1","eventn_ctx_user_anonymous_id":"anonym1","eventn_ctx_user_internal_id":"id1kk","eventn_ctx_user_language":"ru-RU","eventn_ctx_utc_time":"2020-12-23T17:55:54.9Z","eventn_ctx_vp_size":"1680x235","source_ip":"127.0.0.1"},{"_timestamp":"2020-06-16T23:00:00Z","api_key":"c2stoken","event_type":"identify","eventn_ctx_doc_encoding":"UTF-8","eventn_ctx_doc_host":"jitsu.com","eventn_ctx_doc_path":"/","eventn_ctx_event_id":"2","eventn_ctx_local_tz_offset":-180,"eventn_ctx_page_title":"Jitsu: Open-source data integration and event collection","eventn_ctx_parsed_ua_ua_family":"Go-http-client","eventn_ctx_parsed_ua_ua_version":"1.1","eventn_ctx_referer":"","eventn_ctx_screen_resolution":"1680x1050","eventn_ctx_url":"https://jitsu.com/","eventn_ctx_user_agent":"Go-http-client/1.1","eventn_ctx_user_anonymous_id":"anonym1","eventn_ctx_user_internal_id":"id1kk","eventn_ctx_user_language":"ru-RU","eventn_ctx_utc_time":"2020-12-24T17:55:54.9Z","eventn_ctx_vp_size":"1680x235","source_ip":"127.0.0.1"}]`
	actual, _ := json.Marshal(objects)

	require.Equal(t, expected, string(actual), "Objects in DWH and expected objects aren't equal")
}
