package destinations

import (
	"github.com/jitsucom/jitsu/server/logevents"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/storages"
	"github.com/spf13/viper"
	"github.com/stretchr/testify/require"
)

type payloadHolder struct {
	payload []byte
}

// 1. create initial tokens(not all) & destinations
// 2. change destination => reloading
// 3. change tokens
// 4. all destinations initialized (because of force update)
// 5. remove all destinations
// 6. initialize all destinations
// 7. remove all destinations again

func TestServiceInit(t *testing.T) {
	viper.Set("server.destinations_reload_sec", 1)
	viper.Set("server.api_keys_reload_sec", 1)
	viper.Set("server.log.path", "")
	viper.Set("sql_debug_log.ddl.enabled", false)

	initialAuth := `{
  "tokens": [
    {
      "client_secret": "token1"
    },
    {
      "client_secret": "token2"
    },
    {
      "client_secret": "token3"
    },
    {
      "client_secret": "token4"
    }
  ]
}`
	authPayload := &payloadHolder{payload: []byte(initialAuth)}
	mockAuthServer := startTestServer(authPayload)
	viper.Set("server.auth", mockAuthServer.URL)
	appconfig.Init(false, "")

	initialDestinations := `{
  "destinations": {
    "redshift_1": {
      "type": "redshift",
      "only_tokens": [
        "token1",
        "token2"
      ],
      "datasource": {
        "host": "host_redshift_1"
      }
    },
    "pg_1": {
      "type": "postgres",
      "only_tokens": [
        "token1",
        "token3"
      ],
      "datasource": {
        "host": "host_pg_1"
      }
    },
    "pg_2": {
      "type": "postgres",
      "mode": "stream",
      "only_tokens": [
        "token3"
      ],
      "datasource": {
        "host": "host_pg_2"
      }
    },
	"pg_with_unknown_token": {
      "type": "postgres",
      "mode": "stream",
      "only_tokens": [
        "token5"
      ],
      "datasource": {
        "host": "host_pg_with_unknown_token"
      }
    }
  }
}`
	payload := &payloadHolder{payload: []byte(initialDestinations)}
	mockDestinationsServer := startTestServer(payload)

	loggerFactory := logevents.NewFactory("/tmp", 5, false, nil, nil, false, 1, false, false)
	destinationsMockFactory := storages.NewMockFactory()
	service, err := NewService(nil, mockDestinationsServer.URL, destinationsMockFactory, loggerFactory, false)
	require.NoError(t, err)
	require.NotNil(t, service)

	initialConfigAsserts(t, service)
	//wasn't changed
	time.Sleep(1 * time.Second)
	initialConfigAsserts(t, service)

	//change
	changedDestinations := `{
  "destinations": {
    "pg_1": {
      "type": "postgres",
      "only_tokens": [
        "token1",
        "token3",
        "token4"
      ],
      "datasource": {
        "host": "host_pg_1"
      }
    },
    "pg_2": {
      "type": "postgres",
      "mode": "stream",
      "only_tokens": [
        "token3"
      ],
      "datasource": {
        "host": "host_pg_2"
      }
    },
    "pg_3": {
      "type": "postgres",
      "mode": "stream",
      "only_tokens": [
        "token4"
      ],
      "datasource": {
        "host": "host_pg_3"
      }
    },
    "pg_4": {
      "type": "postgres",
      "only_tokens": [
        "token3"
      ],
      "datasource": {
        "host": "host_pg_4"
      }
    },
    "pg_5": {
      "type": "postgres",
      "mode": "stream",
      "only_tokens": [
        "token3"
      ],
      "datasource": {
        "host": "host_pg_5"
      }
    }
  }
}`
	payload.payload = []byte(changedDestinations)
	time.Sleep(2 * time.Second)
	changedConfigAsserts(t, service)

	//add new token to authorization
	fullAuth := `{
  "tokens": [
    {
      "client_secret": "token1"
    },
    {
      "client_secret": "token2"
    },
    {
      "client_secret": "token3"
    },
    {
      "client_secret": "token4"
    },
    {
      "client_secret": "token5"
    }
  ]
}`
	authPayload.payload = []byte(fullAuth)
	payload.payload = []byte(initialDestinations)
	time.Sleep(2 * time.Second)
	initialAllConfigAsserts(t, service)

	//delete all
	emptyDestinations := `{}`
	payload.payload = []byte(emptyDestinations)
	time.Sleep(1 * time.Second)
	emptyConfigAsserts(t, service)

	//init all again
	payload.payload = []byte(initialDestinations)
	time.Sleep(1 * time.Second)
	initialAllConfigAsserts(t, service)

	//delete all one more time
	payload.payload = []byte(emptyDestinations)
	time.Sleep(1 * time.Second)
	emptyConfigAsserts(t, service)
}

func initialConfigAsserts(t *testing.T, service *Service) {
	require.Equal(t, 3, len(service.batchStoragesByTokenID))
	require.Equal(t, 3, len(service.consumersByTokenID))

	require.Equal(t, 2, len(service.GetBatchStorages(appconfig.Instance.AuthorizationService.GetTokenID("token1"))))
	require.Equal(t, 1, len(service.GetConsumers(appconfig.Instance.AuthorizationService.GetTokenID("token1"))))

	require.Equal(t, 1, len(service.GetBatchStorages(appconfig.Instance.AuthorizationService.GetTokenID("token2"))))
	require.Equal(t, 1, len(service.GetConsumers(appconfig.Instance.AuthorizationService.GetTokenID("token2"))))

	require.Equal(t, 1, len(service.GetBatchStorages(appconfig.Instance.AuthorizationService.GetTokenID("token3"))))
	require.Equal(t, 2, len(service.GetConsumers(appconfig.Instance.AuthorizationService.GetTokenID("token3"))))

	require.Equal(t, 0, len(service.GetBatchStorages(appconfig.Instance.AuthorizationService.GetTokenID("token5"))))
	require.Equal(t, 0, len(service.GetConsumers(appconfig.Instance.AuthorizationService.GetTokenID("token5"))))
}

func initialAllConfigAsserts(t *testing.T, service *Service) {
	require.Equal(t, 3, len(service.batchStoragesByTokenID))
	require.Equal(t, 4, len(service.consumersByTokenID))

	require.Equal(t, 2, len(service.GetBatchStorages(appconfig.Instance.AuthorizationService.GetTokenID("token1"))))
	require.Equal(t, 1, len(service.GetConsumers(appconfig.Instance.AuthorizationService.GetTokenID("token1"))))

	require.Equal(t, 1, len(service.GetBatchStorages(appconfig.Instance.AuthorizationService.GetTokenID("token2"))))
	require.Equal(t, 1, len(service.GetConsumers(appconfig.Instance.AuthorizationService.GetTokenID("token2"))))

	require.Equal(t, 1, len(service.GetBatchStorages(appconfig.Instance.AuthorizationService.GetTokenID("token3"))))
	require.Equal(t, 2, len(service.GetConsumers(appconfig.Instance.AuthorizationService.GetTokenID("token3"))))

	require.Equal(t, 0, len(service.GetBatchStorages(appconfig.Instance.AuthorizationService.GetTokenID("token5"))))
	require.Equal(t, 1, len(service.GetConsumers(appconfig.Instance.AuthorizationService.GetTokenID("token5"))))
}

func changedConfigAsserts(t *testing.T, service *Service) {
	require.Equal(t, 3, len(service.batchStoragesByTokenID))
	require.Equal(t, 3, len(service.consumersByTokenID))

	require.Equal(t, 1, len(service.GetBatchStorages(appconfig.Instance.AuthorizationService.GetTokenID("token1"))))
	require.Equal(t, 1, len(service.GetConsumers(appconfig.Instance.AuthorizationService.GetTokenID("token1"))))

	require.Equal(t, 0, len(service.GetBatchStorages(appconfig.Instance.AuthorizationService.GetTokenID("token2"))))
	require.Equal(t, 0, len(service.GetConsumers(appconfig.Instance.AuthorizationService.GetTokenID("token2"))))

	require.Equal(t, 2, len(service.GetBatchStorages(appconfig.Instance.AuthorizationService.GetTokenID("token3"))))
	require.Equal(t, 3, len(service.GetConsumers(appconfig.Instance.AuthorizationService.GetTokenID("token3"))))

	require.Equal(t, 1, len(service.GetBatchStorages(appconfig.Instance.AuthorizationService.GetTokenID("token4"))))
	require.Equal(t, 2, len(service.GetConsumers(appconfig.Instance.AuthorizationService.GetTokenID("token4"))))
}

func emptyConfigAsserts(t *testing.T, service *Service) {
	require.Equal(t, 0, len(service.batchStoragesByTokenID))
	require.Equal(t, 0, len(service.consumersByTokenID))

	require.Equal(t, 0, len(service.GetBatchStorages("token1")))
	require.Equal(t, 0, len(service.GetConsumers("token1")))

	require.Equal(t, 0, len(service.GetBatchStorages("token2")))
	require.Equal(t, 0, len(service.GetConsumers("token2")))

	require.Equal(t, 0, len(service.GetBatchStorages("token3")))
	require.Equal(t, 0, len(service.GetConsumers("token3")))

	require.Equal(t, 0, len(service.GetBatchStorages("token4")))
	require.Equal(t, 0, len(service.GetConsumers("token4")))
}

func startTestServer(ph *payloadHolder) *httptest.Server {
	return httptest.NewServer(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Add("Content-type", "application/json")
			w.Write(ph.payload)
		}))
}
