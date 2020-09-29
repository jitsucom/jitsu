package main

import (
	"bytes"
	"github.com/ksensehq/eventnative/events"
	"github.com/ksensehq/eventnative/logging"
	"github.com/ksensehq/eventnative/middleware"
	"github.com/ksensehq/eventnative/test"
	"time"

	"bou.ke/monkey"
	"github.com/ksensehq/eventnative/appconfig"

	"github.com/spf13/viper"
	"github.com/stretchr/testify/require"
	"io/ioutil"
	"log"
	"net"
	"net/http"
	"strconv"
	"testing"
)

func SetTestDefaultParams() {
	viper.Set("log.path", "")
	viper.Set("server.auth", []string{"c2stoken"})
	viper.Set("server.s2s_auth", `[{"token":"s2stoken", "origins":["whiteorigin*"]}]`)
}

func TestApiEvent(t *testing.T) {
	SetTestDefaultParams()
	tests := []struct {
		name             string
		reqUrn           string
		reqOrigin        string
		reqBodyPath      string
		expectedJsonPath string

		expectedHttpCode int
		expectedErrMsg   string
	}{
		{
			"Unauthorized c2s endpoint",
			"/api/v1/event?token=wrongtoken",
			"",
			"test_data/event_input.json",
			"",
			http.StatusUnauthorized,
			"",
		},
		{
			"Unauthorized s2s endpoint",
			"/api/v1/s2s/event?token=wrongtoken",
			"",
			"test_data/s2s_event_input.json",
			"",
			http.StatusUnauthorized,
			"The token isn't a server token. Please use s2s integration token\n",
		},
		{
			"Unauthorized c2s endpoint with s2s token",
			"/api/v1/event?token=s2stoken",
			"",
			"test_data/event_input.json",
			"",
			http.StatusUnauthorized,
			"",
		},
		{
			"Unauthorized s2s wrong origin",
			"/api/v1/s2s/event?token=s2stoken",
			"http://ksense.com",
			"test_data/s2s_event_input.json",
			"",
			http.StatusUnauthorized,
			"",
		},

		{
			"C2S Api event consuming test",
			"/api/v1/event?token=c2stoken",
			"",
			"test_data/event_input.json",
			"test_data/fact_output.json",
			http.StatusOK,
			"",
		},
		{
			"S2S Api event consuming test",
			"/api/v1/s2s/event?token=s2stoken",
			"https://whiteorigin.com/",
			"test_data/s2s_event_input.json",
			"test_data/s2s_fact_output.json",
			http.StatusOK,
			"",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			httpAuthority, _ := getLocalAuthority()

			err := appconfig.Init()
			require.NoError(t, err)
			defer appconfig.Instance.Close()

			inmemWriter := logging.InitInMemoryWriter()
			router := SetupRouter(events.NewDestinationService(map[string][]events.Consumer{
				"c2stoken": {events.NewAsyncLogger(inmemWriter, false)},
				"s2stoken": {events.NewAsyncLogger(inmemWriter, false)},
			}, map[string][]events.StorageProxy{}))

			freezeTime := time.Date(2020, 06, 16, 23, 0, 0, 0, time.UTC)
			patch := monkey.Patch(time.Now, func() time.Time { return freezeTime })
			defer patch.Unpatch()

			server := &http.Server{
				Addr:              httpAuthority,
				Handler:           middleware.Cors(router),
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

			b, err := ioutil.ReadFile(tt.reqBodyPath)
			require.NoError(t, err)

			//check http OPTIONS
			optReq, err := http.NewRequest("OPTIONS", "http://"+httpAuthority+tt.reqUrn, bytes.NewBuffer(b))
			require.NoError(t, err)
			optResp, err := http.DefaultClient.Do(optReq)
			require.NoError(t, err)
			require.Equal(t, 200, optResp.StatusCode)

			//check http POST
			apiReq, err := http.NewRequest("POST", "http://"+httpAuthority+tt.reqUrn, bytes.NewBuffer(b))
			require.NoError(t, err)
			if tt.reqOrigin != "" {
				apiReq.Header.Add("Origin", tt.reqOrigin)
			}
			apiReq.Header.Add("x-real-ip", "95.82.232.185")
			resp, err = http.DefaultClient.Do(apiReq)
			require.NoError(t, err)

			if tt.expectedHttpCode != 200 {
				require.Equal(t, tt.expectedHttpCode, resp.StatusCode, "Http cods aren't equal")

				b, err := ioutil.ReadAll(resp.Body)
				require.NoError(t, err)

				resp.Body.Close()
				require.Equal(t, tt.expectedErrMsg, string(b))
			} else {
				require.Equal(t, "*", resp.Header.Get("Access-Control-Allow-Origin"), "Cors header ACAO is empty")
				require.Equal(t, http.StatusOK, resp.StatusCode, "Http code isn't 200")
				resp.Body.Close()

				time.Sleep(200 * time.Millisecond)
				data := logging.InstanceMock.Data
				require.Equal(t, 1, len(data))

				fBytes, err := ioutil.ReadFile(tt.expectedJsonPath)
				require.NoError(t, err)
				test.JsonBytesEqual(t, fBytes, data[0], "Logged facts aren't equal")
			}
		})
	}
}

func getLocalAuthority() (string, error) {
	addr, err := net.ResolveTCPAddr("tcp", "localhost:0")
	if err != nil {
		return "", err
	}
	l, err := net.ListenTCP("tcp", addr)
	if err != nil {
		return "", err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).IP.String() + ":" + strconv.Itoa(l.Addr().(*net.TCPAddr).Port), nil
}
