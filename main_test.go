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
	viper.Set("server.auth", []string{"test-mock"})
	viper.Set("log.path", "")
}

func TestApiEvent(t *testing.T) {
	SetTestDefaultParams()
	tests := []struct {
		name             string
		reqBodyPath      string
		expectedJsonPath string
	}{
		{
			"Api event consuming test",
			"test_data/event_input.json",
			"test_data/fact_output.json",
		},
		{
			"Api event with ua consuming test",
			"test_data/event_ua_input.json",
			"test_data/fact_ua_output.json",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			httpAuthority, _ := getLocalAuthority()

			err := appconfig.Init()
			require.NoError(t, err)
			defer appconfig.Instance.Close()

			router := SetupRouter(map[string][]events.Consumer{"test-mock": {events.NewAsyncLogger(logging.InitInMemoryWriter(), false)}})

			freezeTime := time.Date(2020, 06, 16, 23, 0, 0, 0, time.UTC)
			patch := monkey.Patch(time.Now, func() time.Time { return freezeTime })
			defer patch.Unpatch()

			server := &http.Server{
				Addr:              httpAuthority,
				Handler:           middleware.AllowWildCardOrigin(router),
				ReadTimeout:       time.Second * 60,
				ReadHeaderTimeout: time.Second * 60,
				IdleTimeout:       time.Second * 65,
			}
			go func() {
				log.Fatal(server.ListenAndServe())
			}()

			log.Println("Started listen and serve " + httpAuthority)

			resp, err := test.RenewGet("http://" + httpAuthority + "/ping")
			require.NoError(t, err)

			b, err := ioutil.ReadFile(tt.reqBodyPath)
			require.NoError(t, err)

			apiReq, err := http.NewRequest("POST", "http://"+httpAuthority+"/api/v1/event?token=test-mock", bytes.NewBuffer(b))
			require.NoError(t, err)

			apiReq.Header.Add("x-real-ip", "95.82.232.185")
			resp, err = http.DefaultClient.Do(apiReq)
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, resp.StatusCode, "Http code isn't 200")
			resp.Body.Close()

			time.Sleep(200 * time.Millisecond)
			data := logging.InstanceMock.Data
			require.Equal(t, 1, len(data))

			fBytes, err := ioutil.ReadFile(tt.expectedJsonPath)
			require.NoError(t, err)
			test.JsonBytesEqual(t, fBytes, data[0], "Logged facts aren't equal")
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
