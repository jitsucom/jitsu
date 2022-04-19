package plugins

import (
	"github.com/stretchr/testify/require"
	"io/ioutil"
	"net/http"
	"net/http/httptest"
	"testing"
)

/** This test depends on internet and requires npm utility
 */
//func TestNewPluginsReporositoryNPM(t *testing.T) {
//	var plugins = map[string]string{"mixpanel": "mixpanel-destination"}
//	_ ,err := NewPluginsRepository(plugins,"")
//	require.NoError(t, err)
//}

func TestNewPluginsReporositoryTarball(t *testing.T) {
	server := startTestServer()
	defer server.Close()
	var plugins = map[string]string{"test": server.URL + "/test.tar.gz"}
	pluginRepository ,err := NewPluginsRepository(plugins,"")
	require.NoError(t, err)
	require.Contains(t, pluginRepository.GetPlugins(), "test")
	plugin := pluginRepository.Get("test")
	require.Equal(t, "test", plugin.Descriptor["type"])
	require.Equal(t, "Test destination", plugin.Descriptor["displayName"])

}

func startTestServer() *httptest.Server {
	return httptest.NewServer(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			bytes, _ := ioutil.ReadFile("test_data/test-destination.tar.gz")
			w.Header().Add("Content-type", "application/gzip")
			w.Write(bytes)
		}))
}