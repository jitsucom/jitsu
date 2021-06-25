package testsuite

import (
	"bou.ke/monkey"
	"context"
	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/caching"
	"github.com/jitsucom/jitsu/server/coordination"
	"github.com/jitsucom/jitsu/server/destinations"
	"github.com/jitsucom/jitsu/server/enrichment"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/fallback"
	"github.com/jitsucom/jitsu/server/geo"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	"github.com/jitsucom/jitsu/server/middleware"
	"github.com/jitsucom/jitsu/server/routers"
	"github.com/jitsucom/jitsu/server/schema"
	"github.com/jitsucom/jitsu/server/sources"
	"github.com/jitsucom/jitsu/server/storages"
	"github.com/jitsucom/jitsu/server/synchronization"
	"github.com/jitsucom/jitsu/server/system"
	"github.com/jitsucom/jitsu/server/telemetry"
	"github.com/jitsucom/jitsu/server/test"
	"github.com/jitsucom/jitsu/server/users"
	"github.com/spf13/viper"
	"github.com/stretchr/testify/require"
	"net/http"
	"testing"
	"time"
)

//Suite is a common test suite for configuring Jitsu Server and keeping test data
type Suite interface {
	HTTPAuthority() string
	Close()
}

//suite is an immutable test suite implementation of Suite
type suite struct {
	freezeTime time.Time
	patchTime  *monkey.PatchGuard

	httpAuthority string
}

//SuiteBuilder is a test Suite builder
type SuiteBuilder interface {
	WithGeoDataMock() SuiteBuilder
	WithMetaStorage(t *testing.T) SuiteBuilder
	WithDestinationService(t *testing.T, destinationConfig string) SuiteBuilder
	WithUserRecognition(t *testing.T) SuiteBuilder
	Build(t *testing.T) Suite
}

//suiteBuilder is a test Suite builder implementation
type suiteBuilder struct {
	freezeTime                       time.Time
	patchTime                        *monkey.PatchGuard
	httpAuthority                    string
	segmentRequestFieldsMapper       events.Mapper
	segmentCompatRequestFieldsMapper events.Mapper
	globalUsersRecognitionConfig     *storages.UsersRecognition
	systemService                    *system.Service

	metaStorage        meta.Storage
	destinationService *destinations.Service
	recognitionService *users.RecognitionService
}

//NewSuiteBuilder returns configured SuiteBuilder
func NewSuiteBuilder(t *testing.T) SuiteBuilder {
	freezeTime := time.Date(2020, 06, 16, 23, 0, 0, 0, time.UTC)
	patch := monkey.Patch(time.Now, func() time.Time { return freezeTime })

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
	consumer := logging.NewAsyncLogger(inmemWriter, false)

	mockStorageFactory := storages.NewMockFactory()
	mockStorage, _, _ := mockStorageFactory.Create("test", storages.DestinationConfig{})
	destinationService := destinations.NewTestService(map[string]*destinations.Unit{"dest1": destinations.NewTestUnit(mockStorage)},
		destinations.TokenizedConsumers{"id1": {"id1": consumer}},
		destinations.TokenizedStorages{},
		destinations.TokenizedIDs{"id1": map[string]bool{"dest1": true}},
		map[string]events.Consumer{"dest1": consumer})

	//** Segment API
	mappings, err := schema.ConvertOldMappings(schema.Default, viper.GetStringSlice("compatibility.segment.endpoint"))
	require.NoError(t, err)
	segmentRequestFieldsMapper, _, err := schema.NewFieldMapper(mappings)
	require.NoError(t, err)

	//Segment compat API
	compatMappings, err := schema.ConvertOldMappings(schema.Default, viper.GetStringSlice("compatibility.segment_compat.endpoint"))
	require.NoError(t, err)
	segmentRequestCompatFieldsMapper, _, err := schema.NewFieldMapper(compatMappings)
	require.NoError(t, err)

	globalRecognitionConfiguration := &storages.UsersRecognition{
		Enabled:             viper.GetBool("users_recognition.enabled"),
		AnonymousIDNode:     viper.GetString("users_recognition.anonymous_id_node"),
		IdentificationNodes: viper.GetStringSlice("users_recognition.identification_nodes"),
		UserIDNode:          viper.GetString("users_recognition.user_id_node"),
	}

	err = globalRecognitionConfiguration.Validate()
	require.NoError(t, err)

	dummyRecognitionService, _ := users.NewRecognitionService(metaStorage, nil, nil, "")

	systemService := system.NewService("")

	return &suiteBuilder{
		freezeTime:                       freezeTime,
		patchTime:                        patch,
		httpAuthority:                    httpAuthority,
		segmentRequestFieldsMapper:       segmentRequestFieldsMapper,
		segmentCompatRequestFieldsMapper: segmentRequestCompatFieldsMapper,
		metaStorage:                      metaStorage,
		globalUsersRecognitionConfig:     globalRecognitionConfiguration,
		recognitionService:               dummyRecognitionService,
		destinationService:               destinationService,
		systemService:                    systemService,
	}
}

//WithGeoDataMock overrides geo.Data and GeoResolver with mock
func (sb *suiteBuilder) WithGeoDataMock() SuiteBuilder {
	geoDataMock := &geo.Data{
		Country: "US",
		City:    "New York",
		Lat:     79.01,
		Lon:     22.02,
		Zip:     "14101",
		Region:  "",
	}
	appconfig.Instance.GeoResolver = geo.Mock{"10.10.10.10": geoDataMock}

	enrichment.InitDefault(
		viper.GetString("server.fields_configuration.src_source_ip"),
		viper.GetString("server.fields_configuration.dst_source_ip"),
		viper.GetString("server.fields_configuration.src_ua"),
		viper.GetString("server.fields_configuration.dst_ua"),
	)

	return sb
}

//WithMetaStorage overrides meta.Storage with configured from viper
func (sb *suiteBuilder) WithMetaStorage(t *testing.T) SuiteBuilder {
	metaStorage, err := meta.NewStorage(viper.Sub("meta.storage"))
	require.NoError(t, err)
	appconfig.Instance.ScheduleClosing(metaStorage)

	sb.metaStorage = metaStorage
	return sb
}

//WithDestinationService overrides destinations.Service with input data configured
func (sb *suiteBuilder) WithDestinationService(t *testing.T, destinationConfig string) SuiteBuilder {
	monitor := coordination.NewInMemoryService([]string{})
	eventsCache := caching.NewEventsCache(sb.metaStorage, 100)
	loggerFactory := logging.NewFactory("/tmp", 5, false, nil, nil)
	destinationsFactory := storages.NewFactory(context.Background(), "/tmp", monitor, eventsCache, loggerFactory, sb.globalUsersRecognitionConfig, sb.metaStorage, 0)
	destinationService, err := destinations.NewService(nil, destinationConfig, destinationsFactory, loggerFactory, false)
	require.NoError(t, err)
	appconfig.Instance.ScheduleClosing(destinationService)

	sb.destinationService = destinationService

	return sb
}

//WithUserRecognition overrides users.RecognitionService with configured one
func (sb *suiteBuilder) WithUserRecognition(t *testing.T) SuiteBuilder {
	usersRecognitionService, err := users.NewRecognitionService(sb.metaStorage, sb.destinationService, sb.globalUsersRecognitionConfig, "/tmp")
	require.NoError(t, err)
	appconfig.Instance.ScheduleClosing(usersRecognitionService)

	sb.recognitionService = usersRecognitionService

	return sb
}

//Build returns Suite and runs HTTP server
//performs ping check before return
func (sb *suiteBuilder) Build(t *testing.T) Suite {
	router := routers.SetupRouter("", sb.metaStorage, sb.destinationService, sources.NewTestService(), synchronization.NewTestTaskService(),
		sb.recognitionService, fallback.NewTestService(), coordination.NewInMemoryService([]string{}),
		caching.NewEventsCache(sb.metaStorage, 100), sb.systemService,
		sb.segmentRequestFieldsMapper, sb.segmentCompatRequestFieldsMapper)

	server := &http.Server{
		Addr:              sb.httpAuthority,
		Handler:           middleware.Cors(router, appconfig.Instance.AuthorizationService.GetClientOrigins),
		ReadTimeout:       time.Second * 60,
		ReadHeaderTimeout: time.Second * 60,
		IdleTimeout:       time.Second * 65,
	}
	go func() {
		logging.Fatal(server.ListenAndServe())
	}()

	logging.Info("Started listen and serve " + sb.httpAuthority)

	//check ping endpoint
	_, err := test.RenewGet("http://" + sb.httpAuthority + "/ping")
	require.NoError(t, err)

	return &suite{
		freezeTime:    sb.freezeTime,
		patchTime:     sb.patchTime,
		httpAuthority: sb.httpAuthority,
	}
}

func (s *suite) HTTPAuthority() string {
	return s.httpAuthority
}

//Close releases all resources
func (s *suite) Close() {
	s.patchTime.Unpatch()
	appconfig.Instance.Close()
	appconfig.Instance.CloseEventsConsumers()
}
