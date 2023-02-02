package testsuit

import (
	"context"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/jitsucom/jitsu/server/config"
	"github.com/jitsucom/jitsu/server/coordination"
	"github.com/jitsucom/jitsu/server/logevents"
	"github.com/jitsucom/jitsu/server/timestamp"

	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/caching"
	"github.com/jitsucom/jitsu/server/destinations"
	"github.com/jitsucom/jitsu/server/enrichment"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/fallback"
	"github.com/jitsucom/jitsu/server/geo"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	"github.com/jitsucom/jitsu/server/middleware"
	"github.com/jitsucom/jitsu/server/multiplexing"
	"github.com/jitsucom/jitsu/server/routers"
	"github.com/jitsucom/jitsu/server/schema"
	"github.com/jitsucom/jitsu/server/sources"
	"github.com/jitsucom/jitsu/server/storages"
	"github.com/jitsucom/jitsu/server/synchronization"
	"github.com/jitsucom/jitsu/server/system"
	"github.com/jitsucom/jitsu/server/telemetry"
	"github.com/jitsucom/jitsu/server/test"
	"github.com/jitsucom/jitsu/server/users"
	"github.com/jitsucom/jitsu/server/wal"
	"github.com/spf13/viper"
	"github.com/stretchr/testify/require"
)

// Suit is a common test suit for configuring Jitsu Server and keeping test data
type Suit interface {
	HTTPAuthority() string
	Close()
}

// suit is an immutable test suit implementation of Suit
type suit struct {
	httpAuthority string
}

// SuiteBuilder is a test Suit builder
type SuiteBuilder interface {
	WithGeoDataMock(geoDataMock *geo.Data) SuiteBuilder
	WithMetaStorage(t *testing.T) SuiteBuilder
	WithDestinationService(t *testing.T, destinationConfig string) SuiteBuilder
	WithUserRecognition(t *testing.T) SuiteBuilder
	Build(t *testing.T) Suit
}

// suiteBuilder is a test Suit builder implementation
type suiteBuilder struct {
	httpAuthority                    string
	segmentRequestFieldsMapper       events.Mapper
	segmentCompatRequestFieldsMapper events.Mapper
	globalUsersRecognitionConfig     *config.UsersRecognition
	systemService                    *system.Service
	eventsCache                      *caching.EventsCache
	geoService                       *geo.Service

	metaStorage        meta.Storage
	destinationService *destinations.Service
	recognitionService *users.RecognitionService
}

// NewSuiteBuilder returns configured SuiteBuilder
func NewSuiteBuilder(t *testing.T) SuiteBuilder {
	timestamp.FreezeTime()

	telemetry.InitTest()
	httpAuthority, _ := test.GetLocalAuthority()

	err := appconfig.Init(false, "")
	require.NoError(t, err)

	enrichment.InitDefault(
		viper.GetString("server.fields_configuration.src_source_ip"),
		viper.GetString("server.fields_configuration.dst_source_ip"),
		viper.GetString("server.fields_configuration.src_ua"),
		viper.GetString("server.fields_configuration.dst_ua"),
	)

	metaStorage := &meta.Dummy{}
	//mock destinations
	inmemWriter := logging.InitInMemoryWriter()
	consumer := logevents.NewSyncLogger(inmemWriter, false)

	mockStorageFactory := storages.NewMockFactory()
	mockStorage, _, _ := mockStorageFactory.Create("test", config.DestinationConfig{})
	destinationService := destinations.NewTestService(map[string]*destinations.Unit{"dest1": destinations.NewTestUnit(mockStorage)},
		destinations.TokenizedConsumers{"id1": {"id1": consumer}},
		destinations.TokenizedStorages{},
		destinations.TokenizedIDs{"id1": map[string]bool{"dest1": true}},
		map[string]events.Consumer{"dest1": consumer})

	//** Segment API
	mappings, err := schema.ConvertOldMappings(config.Default, viper.GetStringSlice("compatibility.segment.endpoint"))
	require.NoError(t, err)
	segmentRequestFieldsMapper, _, err := schema.NewFieldMapper(mappings)
	require.NoError(t, err)

	//Segment compat API
	compatMappings, err := schema.ConvertOldMappings(config.Default, viper.GetStringSlice("compatibility.segment_compat.endpoint"))
	require.NoError(t, err)
	segmentRequestCompatFieldsMapper, _, err := schema.NewFieldMapper(compatMappings)
	require.NoError(t, err)

	globalRecognitionConfiguration := &config.UsersRecognition{
		Enabled:             viper.GetBool("users_recognition.enabled"),
		AnonymousIDNode:     viper.GetString("users_recognition.anonymous_id_node"),
		IdentificationNodes: viper.GetStringSlice("users_recognition.identification_nodes"),
		UserIDNode:          viper.GetString("users_recognition.user_id_node"),
		PoolSize:            viper.GetInt("users_recognition.pool.size"),
		Compression:         viper.GetString("users_recognition.compression"),
		CacheTTLMin:         viper.GetInt("users_recognition.cache_ttl_min"),
	}

	err = globalRecognitionConfiguration.Validate()
	require.NoError(t, err)

	dummyRecognitionService, _ := users.NewRecognitionService(&users.Dummy{}, nil, nil, "/eventn_ctx/user_agent||/user_agent")

	systemService := system.NewService("")

	return &suiteBuilder{
		httpAuthority:                    httpAuthority,
		segmentRequestFieldsMapper:       segmentRequestFieldsMapper,
		segmentCompatRequestFieldsMapper: segmentRequestCompatFieldsMapper,
		metaStorage:                      metaStorage,
		globalUsersRecognitionConfig:     globalRecognitionConfiguration,
		recognitionService:               dummyRecognitionService,
		destinationService:               destinationService,
		systemService:                    systemService,
		eventsCache:                      caching.NewEventsCache(true, metaStorage, 100, 1, 100, 60),
		geoService:                       geo.NewTestService(nil),
	}
}

// WithGeoDataMock overrides geo.Data and GeoResolver with mock
func (sb *suiteBuilder) WithGeoDataMock(geoDataMock *geo.Data) SuiteBuilder {
	if geoDataMock == nil {
		geoDataMock = &geo.Data{
			Country: "US",
			City:    "New York",
			Lat:     79.01,
			Lon:     22.02,
			Zip:     "14101",
			Region:  "",
		}
	}
	//in case when ip_policy=strict or comply
	sb.geoService = geo.NewTestService(geo.Mock{"10.10.10.10": geoDataMock, "10.10.10.1": geoDataMock})

	return sb
}

// WithMetaStorage overrides meta.Storage with configured from viper
func (sb *suiteBuilder) WithMetaStorage(t *testing.T) SuiteBuilder {
	metaStorage, err := meta.InitializeStorage(viper.Sub("meta.storage"))
	require.NoError(t, err)
	appconfig.Instance.ScheduleClosing(metaStorage)

	sb.metaStorage = metaStorage

	sb.eventsCache = caching.NewEventsCache(true, metaStorage, 100, 1, 100, 60)
	return sb
}

// WithDestinationService overrides destinations.Service with input data configured
func (sb *suiteBuilder) WithDestinationService(t *testing.T, destinationConfig string) SuiteBuilder {
	monitor := coordination.NewInMemoryService("")
	tempDir := os.TempDir()
	loggerFactory := logevents.NewFactory(tempDir, 5, false, nil, nil, false, 1, false, false)
	queueFactory := events.NewQueueFactory(nil, 0)
	destinationsFactory := storages.NewFactory(context.Background(), tempDir, sb.geoService, monitor, sb.eventsCache, loggerFactory, sb.globalUsersRecognitionConfig, sb.metaStorage, queueFactory, 0, 1)
	destinationService, err := destinations.NewService(nil, destinationConfig, destinationsFactory, loggerFactory, false)
	require.NoError(t, err)
	appconfig.Instance.ScheduleClosing(destinationService)

	sb.destinationService = destinationService

	return sb
}

// WithUserRecognition overrides users.RecognitionService with configured one
func (sb *suiteBuilder) WithUserRecognition(t *testing.T) SuiteBuilder {
	storage, err := users.InitializeStorage(true, viper.Sub("meta.storage"))
	require.NoError(t, err)

	usersRecognitionService, err := users.NewRecognitionService(storage, sb.destinationService, sb.globalUsersRecognitionConfig, "/eventn_ctx/user_agent||/user_agent")
	require.NoError(t, err)
	appconfig.Instance.ScheduleClosing(usersRecognitionService)

	sb.recognitionService = usersRecognitionService

	return sb
}

// Build returns Suit and runs HTTP server
// performs ping check before return
func (sb *suiteBuilder) Build(t *testing.T) Suit {
	//event processors
	apiProcessor := events.NewAPIProcessor(sb.recognitionService)
	bulkProcessor := events.NewBulkProcessor()
	jsProcessor := events.NewJsProcessor(sb.recognitionService, viper.GetString("server.fields_configuration.user_agent_path"))
	pixelProcessor := events.NewPixelProcessor()
	segmentProcessor := events.NewSegmentProcessor(sb.recognitionService)
	processorHolder := events.NewProcessorHolder(apiProcessor, jsProcessor, pixelProcessor, segmentProcessor, bulkProcessor)

	multiplexingService := multiplexing.NewService(sb.destinationService)
	walService := wal.NewService("/tmp", &logevents.SyncLogger{}, multiplexingService, processorHolder)
	appconfig.Instance.ScheduleWriteAheadLogClosing(walService)

	router := routers.SetupRouter("", sb.metaStorage, sb.destinationService, sources.NewTestService(), synchronization.NewTestTaskService(),
		fallback.NewTestService(), coordination.NewInMemoryService(""), sb.eventsCache, sb.systemService,
		sb.segmentRequestFieldsMapper, sb.segmentCompatRequestFieldsMapper, processorHolder, multiplexingService, walService, sb.geoService, sb.globalUsersRecognitionConfig)

	server := &http.Server{
		Addr:              sb.httpAuthority,
		Handler:           middleware.Cors(router, appconfig.Instance.AuthorizationService.GetClientOrigins),
		ReadTimeout:       time.Second * 5,
		ReadHeaderTimeout: time.Second * 5,
		IdleTimeout:       time.Second * 5,
	}
	go func() {
		logging.Fatal(server.ListenAndServe())
	}()

	logging.Info("Started listen and serve " + sb.httpAuthority)

	//check ping endpoint
	_, err := test.RenewGet("http://" + sb.httpAuthority + "/ping")
	require.NoError(t, err)

	return &suit{
		httpAuthority: sb.httpAuthority,
	}
}

func (s *suit) HTTPAuthority() string {
	return s.httpAuthority
}

// Close releases all resources
func (s *suit) Close() {
	timestamp.UnfreezeTime()
	appconfig.Instance.Close()
	appconfig.Instance.CloseEventsConsumers()
}
