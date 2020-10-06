package destinations

import (
	"context"
	"github.com/ksensehq/eventnative/appconfig"
	"github.com/ksensehq/eventnative/events"
	"github.com/ksensehq/eventnative/storages"
	"github.com/spf13/viper"
	"github.com/stretchr/testify/require"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type payloadHolder struct {
	payload []byte
}

type testProxyMock struct {
}

func (tpm *testProxyMock) Get() (events.Storage, bool) {
	return nil, false
}

func (tpm *testProxyMock) Close() error {
	return nil
}

// 1. init
// 2. change
// 3. remove all
// 4. init again
// 5. remove all again
func TestServiceInit(t *testing.T) {
	viper.Set("server.destinations_reload_sec", 1)
	viper.Set("server.auth", []string{"token1", "token2", "token3", "token4"})
	appconfig.Init()

	initialDestinations := `{
  "redshift_1": {
    "type": "redshift",
    "only_tokens": ["token1", "token2"],
    "datasource": {
      "host": "host_redshift_1"
    }
  },
  "pg_1": {
    "type": "postgres",
    "only_tokens": ["token1", "token3"],
    "datasource": {
      "host": "host_pg_1"
    }
  },
  "pg_2": {
    "type": "postgres",
    "mode": "stream",
    "only_tokens": ["token3"],
    "datasource": {
      "host": "host_pg_2"
    }
  }
}`
	payload := &payloadHolder{payload: []byte(initialDestinations)}
	mockSourceServer := startTestServer(payload)

	service, err := NewService(context.Background(), nil, mockSourceServer.URL, "/tmp", nil, createTestStorage)
	require.NoError(t, err)
	require.NotNil(t, service)

	initialConfigAsserts(t, service)
	//wasn't changed
	time.Sleep(1 * time.Second)
	initialConfigAsserts(t, service)

	//change
	changedDestinations := `{
  "pg_1": {
    "type": "postgres",
    "only_tokens": ["token1", "token3", "token4"],
    "datasource": {
      "host": "host_pg_1"
    }
  },
  "pg_2": {
    "type": "postgres",
    "mode": "stream",
    "only_tokens": ["token3"],
    "datasource": {
      "host": "host_pg_2"
    }
  },
 "pg_3": {
    "type": "postgres",
    "mode": "stream",
    "only_tokens": ["token4"],
    "datasource": {
      "host": "host_pg_3"
    }
  },
"pg_4": {
    "type": "postgres",
    "only_tokens": ["token3"],
    "datasource": {
      "host": "host_pg_4"
    }
  },
"pg_5": {
    "type": "postgres",
    "mode": "stream",
    "only_tokens": ["token3"],
    "datasource": {
      "host": "host_pg_5"
    }
  }
}`
	payload.payload = []byte(changedDestinations)
	time.Sleep(1 * time.Second)
	changedConfigAsserts(t, service)

	//delete all
	emptyDestinations := `{}`
	payload.payload = []byte(emptyDestinations)
	time.Sleep(1 * time.Second)
	emptyConfigAsserts(t, service)

	//init all again
	payload.payload = []byte(initialDestinations)
	time.Sleep(1 * time.Second)
	initialConfigAsserts(t, service)

	//delete all one more time
	payload.payload = []byte(emptyDestinations)
	time.Sleep(1 * time.Second)
	emptyConfigAsserts(t, service)
}

func initialConfigAsserts(t *testing.T, service *Service) {
	require.Equal(t, 3, len(service.storagesByTokenId))
	require.Equal(t, 3, len(service.consumersByTokenId))

	require.Equal(t, 2, len(service.GetStorages(appconfig.Instance.AuthorizationService.GetTokenId("token1"))))
	require.Equal(t, 1, len(service.GetConsumers(appconfig.Instance.AuthorizationService.GetTokenId("token1"))))

	require.Equal(t, 1, len(service.GetStorages(appconfig.Instance.AuthorizationService.GetTokenId("token2"))))
	require.Equal(t, 1, len(service.GetConsumers(appconfig.Instance.AuthorizationService.GetTokenId("token2"))))

	require.Equal(t, 2, len(service.GetStorages(appconfig.Instance.AuthorizationService.GetTokenId("token3"))))
	require.Equal(t, 2, len(service.GetConsumers(appconfig.Instance.AuthorizationService.GetTokenId("token3"))))
}

func changedConfigAsserts(t *testing.T, service *Service) {
	require.Equal(t, 3, len(service.storagesByTokenId))
	require.Equal(t, 3, len(service.consumersByTokenId))

	require.Equal(t, 1, len(service.GetStorages(appconfig.Instance.AuthorizationService.GetTokenId("token1"))))
	require.Equal(t, 1, len(service.GetConsumers(appconfig.Instance.AuthorizationService.GetTokenId("token1"))))

	require.Equal(t, 0, len(service.GetStorages(appconfig.Instance.AuthorizationService.GetTokenId("token2"))))
	require.Equal(t, 0, len(service.GetConsumers(appconfig.Instance.AuthorizationService.GetTokenId("token2"))))

	require.Equal(t, 4, len(service.GetStorages(appconfig.Instance.AuthorizationService.GetTokenId("token3"))))
	require.Equal(t, 3, len(service.GetConsumers(appconfig.Instance.AuthorizationService.GetTokenId("token3"))))

	require.Equal(t, 2, len(service.GetStorages(appconfig.Instance.AuthorizationService.GetTokenId("token4"))))
	require.Equal(t, 2, len(service.GetConsumers(appconfig.Instance.AuthorizationService.GetTokenId("token4"))))
}

func emptyConfigAsserts(t *testing.T, service *Service) {
	require.Equal(t, 0, len(service.storagesByTokenId))
	require.Equal(t, 0, len(service.consumersByTokenId))

	require.Equal(t, 0, len(service.GetStorages("token1")))
	require.Equal(t, 0, len(service.GetConsumers("token1")))

	require.Equal(t, 0, len(service.GetStorages("token2")))
	require.Equal(t, 0, len(service.GetConsumers("token2")))

	require.Equal(t, 0, len(service.GetStorages("token3")))
	require.Equal(t, 0, len(service.GetConsumers("token3")))

	require.Equal(t, 0, len(service.GetStorages("token4")))
	require.Equal(t, 0, len(service.GetConsumers("token4")))
}

func startTestServer(ph *payloadHolder) *httptest.Server {
	return httptest.NewServer(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Write(ph.payload)
		}))
}

func createTestStorage(ctx context.Context, name, logEventPath string, destination storages.DestinationConfig, monitorKeeper storages.MonitorKeeper) (events.StorageProxy, *events.PersistentQueue, error) {
	var eventQueue *events.PersistentQueue
	if destination.Mode == storages.StreamMode {
		eventQueue, _ = events.NewPersistentQueue(name, "/tmp")
	}
	return &testProxyMock{}, eventQueue, nil
}
