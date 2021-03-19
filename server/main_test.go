package main

import (
	"bytes"
	"context"
	"fmt"
	"io/ioutil"
	"log"
	"net/http"
	"strings"
	"testing"
	"time"

	"bou.ke/monkey"
	"github.com/gin-gonic/gin/binding"
	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/caching"
	"github.com/jitsucom/jitsu/server/coordination"
	"github.com/jitsucom/jitsu/server/destinations"
	"github.com/jitsucom/jitsu/server/enrichment"
	"github.com/jitsucom/jitsu/server/events"
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
	"github.com/jitsucom/jitsu/server/uuid"
	"github.com/spf13/viper"
	"github.com/stretchr/testify/require"
)

func SetTestDefaultParams() {
	viper.Set("log.path", "")
	viper.Set("server.auth", `{"tokens":[{"id":"id1","client_secret":"c2stoken","server_secret":"s2stoken","origins":["whiteorigin*"]}]}`)
	viper.Set("server.log.path", "")
}

func TestCors(t *testing.T) {
	uuid.InitMock()
	binding.EnableDecoderUseNumber = true

	SetTestDefaultParams()
	tests := []struct {
		Name       string
		ReqUrn     string
		ReqOrigin  string
		XAuthToken string

		ExpectedCorsHeaderValue string
		ResponseCode            int
	}{
		{
			"Wrong token in event url",
			"/api/v1/event?token=wrongtoken",
			"",
			"",
			"",
			401,
		},
		{
			"Wrong token in random url",
			"/api.dadaba?p_dn1231dada=wrongtoken",
			"",
			"",
			"",
			401,
		},
		{
			"Wrong token in header event url",
			"/api/v1/event",
			"",
			"wrongtoken",
			"",
			401,
		},
		{
			"Wrong token in header random url",
			"/api.d2d3ba",
			"",
			"wrongtoken",
			"",
			401,
		},
		{
			"Wrong origin with token in event url",
			"/api/v1/event?token=c2stoken",
			"origin.com",
			"",
			"",
			200,
		},
		{
			"Wrong origin with token in random url",
			"/api.djla9a?p_dlkiud7=wrongtoken",
			"origin.com",
			"",
			"",
			401,
		},
		{
			"Wrong origin with token in header event url",
			"/api/v1/event",
			"origin.com",
			"c2stoken",
			"",
			200,
		},
		{
			"Wrong origin with token in header random url",
			"/api.dn12o31",
			"origin.com",
			"c2stoken",
			"",
			200,
		},
		{
			"Ok origin with token in event url",
			"/api/v1/event?token=c2stoken",
			"https://whiteorigin.com",
			"",
			"https://whiteorigin.com",
			200,
		},
		{
			"Ok origin with token in random url",
			"/api.dn1239?p_km12418hdasd=c2stoken",
			"https://whiteorigin.com",
			"",
			"https://whiteorigin.com",
			200,
		},
		{
			"Ok origin with token in header event url",
			"/api/v1/event",
			"http://whiteoriginmy.com",
			"c2stoken",
			"http://whiteoriginmy.com",
			200,
		},
		{
			"Ok origin with token in header random url",
			"/api.i12310h",
			"http://whiteoriginmy.com",
			"c2stoken",
			"http://whiteoriginmy.com",
			200,
		},
		{
			"S2S endpoint without cors",
			"/api/v1/s2s/event?token=wrongtoken",
			"",
			"",
			"",
			200,
		},
		{
			"static endpoint /t",
			"/t/path",
			"",
			"",
			"*",
			200,
		},
		{
			"static endpoint /s",
			"/s/path",
			"",
			"",
			"*",
			200,
		},
		{
			"static endpoint /p",
			"/p/path",
			"",
			"",
			"*",
			200,
		},
	}
	for _, tt := range tests {
		t.Run(tt.Name, func(t *testing.T) {
			telemetry.InitTest()
			httpAuthority, _ := test.GetLocalAuthority()

			err := appconfig.Init(false)
			require.NoError(t, err)
			defer appconfig.Instance.Close()

			inmemWriter := logging.InitInMemoryWriter()
			destinationService := destinations.NewTestService(destinations.TokenizedConsumers{"id1": {"id1": logging.NewAsyncLogger(inmemWriter, false)}},
				destinations.TokenizedStorages{}, destinations.TokenizedIds{})
			appconfig.Instance.ScheduleClosing(destinationService)

			dummyRecognitionService, _ := users.NewRecognitionService(&meta.Dummy{}, nil, nil, "")
			router := routers.SetupRouter("", destinationService, sources.NewTestService(), synchronization.NewTestTaskService(),
				dummyRecognitionService, fallback.NewTestService(), coordination.NewInMemoryService([]string{}),
				caching.NewEventsCache(&meta.Dummy{}, 100), events.NewCache(5))

			freezeTime := time.Date(2020, 06, 16, 23, 0, 0, 0, time.UTC)
			patch := monkey.Patch(time.Now, func() time.Time { return freezeTime })
			defer patch.Unpatch()

			server := &http.Server{
				Addr:              httpAuthority,
				Handler:           middleware.Cors(router, appconfig.Instance.AuthorizationService.GetClientOrigins),
				ReadTimeout:       time.Second * 60,
				ReadHeaderTimeout: time.Second * 60,
				IdleTimeout:       time.Second * 65,
			}
			go func() {
				log.Fatal(server.ListenAndServe())
			}()

			logging.Info("Started listen and serve " + httpAuthority)

			//check ping endpoint
			_, err = test.RenewGet("http://" + httpAuthority + "/ping")
			require.NoError(t, err)

			//check http OPTIONS
			optReq, err := http.NewRequest(http.MethodOptions, "http://"+httpAuthority+tt.ReqUrn, nil)
			require.NoError(t, err)
			if tt.ReqOrigin != "" {
				optReq.Header.Add("Origin", tt.ReqOrigin)
			}
			if tt.XAuthToken != "" {
				optReq.Header.Add("X-Auth-Token", tt.XAuthToken)
			}
			optResp, err := http.DefaultClient.Do(optReq)
			require.NoError(t, err)

			require.Equal(t, tt.ResponseCode, optResp.StatusCode)

			require.Equal(t, tt.ExpectedCorsHeaderValue, optResp.Header.Get("Access-Control-Allow-Origin"), "Cors header ACAO values aren't equal")
			optResp.Body.Close()
		})
	}
}

func TestApiEvent(t *testing.T) {
	uuid.InitMock()
	binding.EnableDecoderUseNumber = true

	SetTestDefaultParams()
	tests := []test.Integration{
		{
			"Unauthorized c2s endpoint",
			"/api/v1/event?token=wrongtoken",
			"test_data/event_input.json",
			"",
			"",
			http.StatusUnauthorized,
			`{"message":"The token is not found","error":""}`,
		},
		{
			"Unauthorized s2s endpoint",
			"/api/v1/s2s/event?token=c2stoken",
			"test_data/api_event_input.json",
			"",
			"",
			http.StatusUnauthorized,
			`{"message":"The token isn't a server token. Please use s2s integration token","error":""}`,
		},
		{
			"Unauthorized c2s endpoint with s2s token",
			"/api/v1/event?token=s2stoken",
			"test_data/event_input.json",
			"",
			"",
			http.StatusUnauthorized,
			`{"message":"The token is not found","error":""}`,
		},
		{
			"C2S event consuming test",
			"/api/v1/event?token=c2stoken",
			"test_data/event_input.json",
			"test_data/fact_output.json",
			"",
			http.StatusOK,
			"",
		},
		{
			"S2S Api event consuming test",
			"/api/v1/s2s/event",
			"test_data/api_event_input.json",
			"test_data/api_fact_output.json",
			"s2stoken",
			http.StatusOK,
			"",
		},
		{
			"S2S Api malformed event test",
			"/api/v1/s2s/event",
			"test_data/malformed_input.json",
			"",
			"s2stoken",
			http.StatusBadRequest,
			`{"message":"Failed to parse body","error":"invalid character 'a' looking for beginning of object key string"}`,
		},
		{
			"Randomized c2s endpoint",
			"/api.dhb31?p_neoq231=c2stoken",
			"test_data/event_input.json",
			"test_data/fact_output.json",
			"",
			http.StatusOK,
			"",
		},
	}
	for _, tt := range tests {
		t.Run(tt.Name, func(t *testing.T) {
			telemetry.InitTest()
			httpAuthority, _ := test.GetLocalAuthority()

			err := appconfig.Init(false)
			require.NoError(t, err)
			defer appconfig.Instance.Close()

			inmemWriter := logging.InitInMemoryWriter()
			destinationService := destinations.NewTestService(destinations.TokenizedConsumers{"id1": {"id1": logging.NewAsyncLogger(inmemWriter, false)}},
				destinations.TokenizedStorages{}, destinations.TokenizedIds{})
			appconfig.Instance.ScheduleClosing(destinationService)

			dummyRecognitionService, _ := users.NewRecognitionService(&meta.Dummy{}, nil, nil, "")
			router := routers.SetupRouter("", destinationService, sources.NewTestService(), synchronization.NewTestTaskService(),
				dummyRecognitionService, fallback.NewTestService(), coordination.NewInMemoryService([]string{}),
				caching.NewEventsCache(&meta.Dummy{}, 100), events.NewCache(5))

			freezeTime := time.Date(2020, 06, 16, 23, 0, 0, 0, time.UTC)
			patch := monkey.Patch(time.Now, func() time.Time { return freezeTime })
			defer patch.Unpatch()

			server := &http.Server{
				Addr:              httpAuthority,
				Handler:           middleware.Cors(router, appconfig.Instance.AuthorizationService.GetClientOrigins),
				ReadTimeout:       time.Second * 60,
				ReadHeaderTimeout: time.Second * 60,
				IdleTimeout:       time.Second * 65,
			}
			go func() {
				log.Fatal(server.ListenAndServe())
			}()

			logging.Info("Started listen and serve " + httpAuthority)

			//check ping endpoint
			resp, err := test.RenewGet("http://" + httpAuthority + "/ping")
			require.NoError(t, err)

			b, err := ioutil.ReadFile(tt.ReqBodyPath)
			require.NoError(t, err)

			//check http POST
			apiReq, err := http.NewRequest("POST", "http://"+httpAuthority+tt.ReqUrn, bytes.NewBuffer(b))
			require.NoError(t, err)
			if tt.XAuthToken != "" {
				apiReq.Header.Add("x-auth-token", tt.XAuthToken)
			}
			apiReq.Header.Add("x-real-ip", "95.82.232.185")
			resp, err = http.DefaultClient.Do(apiReq)
			require.NoError(t, err)

			if tt.ExpectedHttpCode != 200 {
				require.Equal(t, tt.ExpectedHttpCode, resp.StatusCode, "Http cods aren't equal")

				b, err := ioutil.ReadAll(resp.Body)
				require.NoError(t, err)

				resp.Body.Close()
				require.Equal(t, tt.ExpectedErrMsg, string(b))
			} else {
				require.Equal(t, http.StatusOK, resp.StatusCode, "Http code isn't 200")
				b, err := ioutil.ReadAll(resp.Body)
				require.NoError(t, err)
				resp.Body.Close()

				require.Equal(t, `{"status":"ok"}`, string(b))

				time.Sleep(200 * time.Millisecond)
				data := logging.InstanceMock.Data
				require.Equal(t, 1, len(data))

				fBytes, err := ioutil.ReadFile(tt.ExpectedJsonPath)
				require.NoError(t, err)
				test.JsonBytesEqual(t, fBytes, data[0], "Logged facts aren't equal")
			}
		})
	}
}

func TestPostgresStreamInsert(t *testing.T) {
	configTemplate := `{"destinations": {
  			"test": {
        		"type": "postgres",
        		"mode": "stream",
				"only_tokens": ["s2stoken"],
        		"data_layout": {
          			"table_name_template": "events_without_pk"
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
	testPostgresStoreEvents(t, configTemplate, "/api/v1/s2s/event?token=s2stoken", 5, "events_without_pk", 5, false)
}

func TestPostgresStreamInsertWithPK(t *testing.T) {
	configTemplate := `{"destinations": {
  			"test": {
        		"type": "postgres",
        		"mode": "stream",
				"only_tokens": ["s2stoken"],
        		"data_layout": {
          			"table_name_template": "events_with_pk",
					"primary_key_fields": ["email"]
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
	testPostgresStoreEvents(t, configTemplate, "/api/v1/s2s/event?token=s2stoken", 5, "events_with_pk", 1, false)
}

func TestPostgresDryRun(t *testing.T) {
	configTemplate := `{"destinations": {
  			"test": {
        		"type": "postgres",
				"staged": true,
        		"mode": "stream",
				"only_tokens": ["s2stoken"],
				"data_layout": {
					"table_name_template": "dry_run"
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
	testPostgresStoreEvents(t, configTemplate, "/api/v1/events/dry-run?token=s2stoken&destination_id=test", 1, "dry_run", 0, true)
}

func testPostgresStoreEvents(t *testing.T, pgDestinationConfigTemplate string, endpoint string, sendEventsCount int,
	tableName string, expectedEventsCount int, dryRun bool) {
	ctx := context.Background()
	container, err := test.NewPostgresContainer(ctx)
	if err != nil {
		t.Fatalf("failed to initialize container: %v", err)
	}
	defer container.Close()

	telemetry.InitTest()
	viper.Set("log.path", "")
	viper.Set("server.auth", `{"tokens":[{"id":"id1","server_secret":"s2stoken"}]}`)

	destinationConfig := fmt.Sprintf(pgDestinationConfigTemplate, container.Host, container.Port, container.Database, container.Schema, container.Username, container.Password)

	httpAuthority, _ := test.GetLocalAuthority()
	err = appconfig.Init(false)
	require.NoError(t, err)
	defer appconfig.Instance.Close()

	enrichment.InitDefault()
	monitor := coordination.NewInMemoryService([]string{})
	eventsCache := caching.NewEventsCache(&meta.Dummy{}, 100)
	loggerFactory := logging.NewFactory("/tmp", 5, false, nil, nil)
	destinationsFactory := storages.NewFactory(ctx, "/tmp", monitor, eventsCache, loggerFactory, nil)
	destinationService, err := destinations.NewService(nil, destinationConfig, destinationsFactory, loggerFactory)
	require.NoError(t, err)
	defer destinationService.Close()

	dummyRecognitionService, _ := users.NewRecognitionService(&meta.Dummy{}, nil, nil, "")
	router := routers.SetupRouter("", destinationService, sources.NewTestService(), synchronization.NewTestTaskService(),
		dummyRecognitionService, fallback.NewTestService(), coordination.NewInMemoryService([]string{}),
		caching.NewEventsCache(&meta.Dummy{}, 100), events.NewCache(5))

	server := &http.Server{
		Addr:              httpAuthority,
		Handler:           middleware.Cors(router, appconfig.Instance.AuthorizationService.GetClientOrigins),
		ReadTimeout:       time.Second * 60,
		ReadHeaderTimeout: time.Second * 60,
		IdleTimeout:       time.Second * 65,
	}
	go func() {
		log.Fatal(server.ListenAndServe())
	}()

	logging.Info("Started listen and serve " + httpAuthority)
	time.Sleep(200 * time.Millisecond)

	_, err = test.RenewGet("http://" + httpAuthority + "/ping")
	require.NoError(t, err)
	requestValue := []byte(`{"email": "test@domain.com"}`)
	for i := 0; i < sendEventsCount; i++ {
		apiReq, err := http.NewRequest("POST", "http://"+httpAuthority+endpoint, bytes.NewBuffer(requestValue))
		require.NoError(t, err)
		resp, err := http.DefaultClient.Do(apiReq)
		require.NoError(t, err)
		require.Equal(t, http.StatusOK, resp.StatusCode, "Http code isn't 200")
		resp.Body.Close()
		time.Sleep(200 * time.Millisecond)
	}
	rows, err := container.CountRows(tableName)
	if !dryRun {
		require.NoError(t, err)
	}
	require.Equal(t, expectedEventsCount, rows)
}

//func TestClickhouseStreamInsert(t *testing.T) {
//	configTemplate := `{"destinations": {
//  			"test": {
//        		"type": "clickhouse",
//        		"mode": "stream",
//				"only_tokens": ["s2stoken"],
//        		"data_layout": {
//          			"table_name_template": "events_without_pk"
//				},
//        		"clickhouse": {
//          			"dsns": [%s],
//          			"db": "%s"
//        		}
//      		}
//    	}}`
//	testClickhouseStoreEvents(t, configTemplate, 5, "events_without_pk")
//}

func TestClickhouseStreamInsertWithMerge(t *testing.T) {
	configTemplate := `{"destinations": {
 			"test": {
       		"type": "clickhouse",
       		"mode": "stream",
				"only_tokens": ["s2stoken"],
       		"data_layout": {
         			"table_name_template": "events_with_pk"
				},
       		"clickhouse": {
         			"dsns": [%s],
         			"db": "%s",
					"engine": {
						"raw_statement": "ENGINE = ReplacingMergeTree(key) ORDER BY (key)"
					}
       		}
     		}
   	}}`
	testClickhouseStoreEvents(t, configTemplate, 5, "events_with_pk", 1)
}

func testClickhouseStoreEvents(t *testing.T, configTemplate string, sendEventsCount int, tableName string, expectedEventsCount int) {
	ctx := context.Background()
	container, err := test.NewClickhouseContainer(ctx)
	if err != nil {
		t.Fatalf("failed to initialize container: %v", err)
	}
	defer container.Close()
	telemetry.InitTest()
	viper.Set("log.path", "")
	viper.Set("server.auth", `{"tokens":[{"id":"id1","server_secret":"s2stoken"}]}`)

	dsns := make([]string, len(container.Dsns))
	for i, dsn := range container.Dsns {
		dsns[i] = "\"" + dsn + "\""
	}
	destinationConfig := fmt.Sprintf(configTemplate, strings.Join(dsns, ","), container.Database)

	httpAuthority, _ := test.GetLocalAuthority()
	err = appconfig.Init(false)
	require.NoError(t, err)
	defer appconfig.Instance.Close()

	monitor := coordination.NewInMemoryService([]string{})
	eventsCache := caching.NewEventsCache(&meta.Dummy{}, 100)
	loggerFactory := logging.NewFactory("/tmp", 5, false, nil, nil)
	destinationsFactory := storages.NewFactory(ctx, "/tmp", monitor, eventsCache, loggerFactory, nil)
	destinationService, err := destinations.NewService(nil, destinationConfig, destinationsFactory, loggerFactory)
	require.NoError(t, err)
	appconfig.Instance.ScheduleClosing(destinationService)

	dummyRecognitionService, _ := users.NewRecognitionService(&meta.Dummy{}, nil, nil, "")
	router := routers.SetupRouter("", destinationService, sources.NewTestService(), synchronization.NewTestTaskService(),
		dummyRecognitionService, fallback.NewTestService(), coordination.NewInMemoryService([]string{}),
		caching.NewEventsCache(&meta.Dummy{}, 100), events.NewCache(5))

	server := &http.Server{
		Addr:              httpAuthority,
		Handler:           middleware.Cors(router, appconfig.Instance.AuthorizationService.GetClientOrigins),
		ReadTimeout:       time.Second * 60,
		ReadHeaderTimeout: time.Second * 60,
		IdleTimeout:       time.Second * 65,
	}
	go func() {
		log.Fatal(server.ListenAndServe())
	}()

	logging.Info("Started listen and serve " + httpAuthority)

	_, err = test.RenewGet("http://" + httpAuthority + "/ping")
	require.NoError(t, err)
	requestValue := []byte(`{"email": "test@domain.com", "key": 1}`)
	for i := 0; i < sendEventsCount; i++ {
		apiReq, err := http.NewRequest("POST", "http://"+httpAuthority+"/api/v1/s2s/event?token=s2stoken", bytes.NewBuffer(requestValue))
		require.NoError(t, err)
		resp, err := http.DefaultClient.Do(apiReq)
		require.NoError(t, err)
		require.Equal(t, http.StatusOK, resp.StatusCode, "Http code isn't 200")
		resp.Body.Close()
		time.Sleep(200 * time.Millisecond)
	}
	rows, err := container.CountRows(tableName)
	require.NoError(t, err)
	require.Equal(t, expectedEventsCount, rows)
}
