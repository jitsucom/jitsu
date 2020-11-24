package main

import (
	"bytes"
	"context"
	"fmt"
	"github.com/gin-gonic/gin/binding"
	"github.com/jitsucom/eventnative/destinations"
	"github.com/jitsucom/eventnative/events"
	"github.com/jitsucom/eventnative/fallback"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/middleware"
	"github.com/jitsucom/eventnative/sources"
	"github.com/jitsucom/eventnative/storages"
	"github.com/jitsucom/eventnative/synchronization"
	"github.com/jitsucom/eventnative/telemetry"
	"github.com/jitsucom/eventnative/test"
	"github.com/jitsucom/eventnative/uuid"
	"strings"
	"time"

	"bou.ke/monkey"
	"github.com/jitsucom/eventnative/appconfig"

	"github.com/spf13/viper"
	"github.com/stretchr/testify/require"
	"io/ioutil"
	"log"
	"net/http"
	"testing"
)

func SetTestDefaultParams() {
	viper.Set("log.path", "")
	viper.Set("server.auth", `{"tokens":[{"id":"id1","client_secret":"c2stoken","server_secret":"s2stoken","origins":["whiteorigin*"]}]}`)
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
	}{
		{
			"Wrong token in event url",
			"/api/v1/event?token=wrongtoken",
			"",
			"",
			"",
		},
		{
			"Wrong token in random url",
			"/api.dadaba?p_dn1231dada=wrongtoken",
			"",
			"",
			"",
		},
		{
			"Wrong token in header event url",
			"/api/v1/event",
			"",
			"wrongtoken",
			"",
		},
		{
			"Wrong token in header random url",
			"/api.d2d3ba",
			"",
			"wrongtoken",
			"",
		},
		{
			"Wrong origin with token in event url",
			"/api/v1/event?token=c2stoken",
			"origin.com",
			"",
			"",
		},
		{
			"Wrong origin with token in random url",
			"/api.djla9a?p_dlkiud7=wrongtoken",
			"origin.com",
			"",
			"",
		},
		{
			"Wrong origin with token in header event url",
			"/api/v1/event",
			"origin.com",
			"c2stoken",
			"",
		},
		{
			"Wrong origin with token in header random url",
			"/api.dn12o31",
			"origin.com",
			"c2stoken",
			"",
		},
		{
			"Ok origin with token in event url",
			"/api/v1/event?token=c2stoken",
			"https://whiteorigin.com",
			"",
			"https://whiteorigin.com",
		},
		{
			"Ok origin with token in random url",
			"/api.dn1239?p_km12418hdasd=c2stoken",
			"https://whiteorigin.com",
			"",
			"https://whiteorigin.com",
		},
		{
			"Ok origin with token in header event url",
			"/api/v1/event",
			"http://whiteoriginmy.com",
			"c2stoken",
			"http://whiteoriginmy.com",
		},
		{
			"Ok origin with token in header random url",
			"/api.i12310h",
			"http://whiteoriginmy.com",
			"c2stoken",
			"http://whiteoriginmy.com",
		},
		{
			"S2S endpoint without cors",
			"/api/v1/s2s/event?token=wrongtoken",
			"",
			"",
			"",
		},
		{
			"static endpoint /t",
			"/t/path",
			"",
			"",
			"*",
		},
		{
			"static endpoint /s",
			"/s/path",
			"",
			"",
			"*",
		},
		{
			"static endpoint /p",
			"/p/path",
			"",
			"",
			"*",
		},
	}
	for _, tt := range tests {
		t.Run(tt.Name, func(t *testing.T) {
			telemetry.Init("test", "test", "test", true)
			httpAuthority, _ := test.GetLocalAuthority()

			err := appconfig.Init()
			require.NoError(t, err)
			defer appconfig.Instance.Close()

			inmemWriter := logging.InitInMemoryWriter()
			router := SetupRouter(destinations.NewTestService(
				map[string]map[string]events.Consumer{
					"id1": {"id1": events.NewAsyncLogger(inmemWriter, false)},
				}, map[string]map[string]events.StorageProxy{}), "", &synchronization.InMemoryService{},
				events.NewCache(5), sources.NewTestService(), fallback.NewTestService())

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
			require.Equal(t, 200, optResp.StatusCode)

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
			`{"message":"Wrong token","error":""}`,
		},
		{
			"Unauthorized s2s endpoint",
			"/api/v1/s2s/event?token=wrongtoken",
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
			`{"message":"Wrong token","error":""}`,
		},
		{
			"C2S Api event consuming test",
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
			telemetry.Init("test", "test", "test", true)
			httpAuthority, _ := test.GetLocalAuthority()

			err := appconfig.Init()
			require.NoError(t, err)
			defer appconfig.Instance.Close()

			inmemWriter := logging.InitInMemoryWriter()
			router := SetupRouter(destinations.NewTestService(
				map[string]map[string]events.Consumer{
					"id1": {"id1": events.NewAsyncLogger(inmemWriter, false)},
				}, map[string]map[string]events.StorageProxy{}), "", &synchronization.InMemoryService{},
				events.NewCache(5), sources.NewTestService(), fallback.NewTestService())

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
	testPostgresStoreEvents(t, configTemplate, 5, "events_without_pk")
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
	testPostgresStoreEvents(t, configTemplate, 1, "events_with_pk")
}

func testPostgresStoreEvents(t *testing.T, pgDestinationConfigTemplate string, expectedEventsCount int, tableName string) {
	ctx := context.Background()
	container, err := test.NewPostgresContainer(ctx)
	if err != nil {
		t.Fatalf("failed to initialize container: %v", err)
	}
	defer container.Close()
	telemetry.Init("test", "test", "test", true)
	viper.Set("log.path", "")
	viper.Set("server.auth", `{"tokens":[{"id":"id1","server_secret":"s2stoken"}]}`)

	destinationConfig := fmt.Sprintf(pgDestinationConfigTemplate, container.Host, container.Port, container.Database, container.Schema, container.Username, container.Password)
	viper.Set("dest", destinationConfig)
	httpAuthority, _ := test.GetLocalAuthority()
	err = appconfig.Init()
	require.NoError(t, err)
	defer appconfig.Instance.Close()
	monitor := &synchronization.InMemoryService{}
	dest, err := destinations.NewService(ctx, viper.Sub("dest"), destinationConfig, "/tmp", "/tmp/fallback", 5, monitor, storages.Create)
	require.NoError(t, err)
	defer dest.Close()
	router := SetupRouter(dest, "", &synchronization.InMemoryService{}, events.NewCache(5), sources.NewTestService(), fallback.NewTestService())

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
	requestValue := []byte(`{"email": "test@domain.com"}`)
	for i := 0; i < 5; i++ {
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
	testClickhouseStoreEvents(t, configTemplate, 1, "events_with_pk")
}

func testClickhouseStoreEvents(t *testing.T, configTemplate string, expectedEventsCount int, tableName string) {
	ctx := context.Background()
	container, err := test.NewClickhouseContainer(ctx)
	if err != nil {
		t.Fatalf("failed to initialize container: %v", err)
	}
	defer container.Close()
	telemetry.Init("test", "test", "test", true)
	viper.Set("log.path", "")
	viper.Set("server.auth", `{"tokens":[{"id":"id1","server_secret":"s2stoken"}]}`)

	dsns := make([]string, len(container.Dsns))
	for i, dsn := range container.Dsns {
		dsns[i] = "\"" + dsn + "\""
	}
	destinationConfig := fmt.Sprintf(configTemplate, strings.Join(dsns, ","), container.Database)
	viper.Set("dest", destinationConfig)
	httpAuthority, _ := test.GetLocalAuthority()
	err = appconfig.Init()
	require.NoError(t, err)
	defer appconfig.Instance.Close()
	dest, err := destinations.NewService(ctx, viper.Sub("dest"), destinationConfig, "/tmp", "/tmp/fallback", 5, &synchronization.InMemoryService{}, storages.Create)
	require.NoError(t, err)
	defer dest.Close()
	router := SetupRouter(dest, "", &synchronization.InMemoryService{}, events.NewCache(5), sources.NewTestService(), fallback.NewTestService())

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
	for i := 0; i < 5; i++ {
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
