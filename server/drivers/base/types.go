package base

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/oauth"
	"github.com/jitsucom/jitsu/server/schema"
	"github.com/spf13/viper"
	"io"
	"io/ioutil"
	"strings"
	"time"
)

const (
	AmplitudeType       = "amplitude"
	FbMarketingType     = "facebook_marketing"
	FirebaseType        = "firebase"
	GoogleAnalyticsType = "google_analytics"
	GooglePlayType      = "google_play"
	GoogleAdsType       = "google_ads"
	RedisType           = "redis"

	SingerType          = "singer"
	AirbyteType         = "airbyte"
	SdkSourceType       = "sdk_source"
	NativeConnectorType = "native"

	GoogleOAuthAuthorizationType = "OAuth"

	DefaultDaysBackToLoad = 365
)

type ObjectsLoader = func(objects []map[string]interface{}, pos int, total int, percent int) error

var (
	DriverConstructors        = make(map[string]func(ctx context.Context, config *SourceConfig, collection *Collection) (Driver, error))
	DriverTestConnectionFuncs = make(map[string]func(config *SourceConfig) error)

	errAccountKeyConfiguration = errors.New("service_account_key must be an object, JSON file path or JSON content string")
)

type GoogleAuthConfig struct {
	Type              string      `mapstructure:"type" json:"type,omitempty" yaml:"type,omitempty"`
	ClientID          string      `mapstructure:"client_id" json:"client_id,omitempty" yaml:"client_id,omitempty"`
	ClientSecret      string      `mapstructure:"client_secret" json:"client_secret,omitempty" yaml:"client_secret,omitempty"`
	RefreshToken      string      `mapstructure:"refresh_token" json:"refresh_token,omitempty" yaml:"refresh_token,omitempty"`
	ServiceAccountKey interface{} `mapstructure:"service_account_key" json:"service_account_key,omitempty" yaml:"service_account_key,omitempty"`
	Subject           string      `mapstructure:"subject" json:"subject,omitempty" yaml:"subject,omitempty"`
}

func (gac *GoogleAuthConfig) Marshal() ([]byte, error) {
	if gac.Type == GoogleOAuthAuthorizationType {
		return json.Marshal(gac.ToGoogleAuthJSON())
	}

	switch gac.ServiceAccountKey.(type) {
	case map[string]interface{}:
		return json.Marshal(gac.ServiceAccountKey)
	case string:
		accountKeyFile := gac.ServiceAccountKey.(string)
		if accountKeyFile == "" {
			return nil, errAccountKeyConfiguration
		} else if strings.HasPrefix(accountKeyFile, "{") {
			return []byte(accountKeyFile), nil
		} else {
			return ioutil.ReadFile(accountKeyFile)
		}
	default:
		return nil, errAccountKeyConfiguration
	}
}

func (gac *GoogleAuthConfig) FillPreconfiguredOauth(sourceType string) {
	if gac == nil || gac.Type != GoogleOAuthAuthorizationType {
		return
	}
	oathFields, ok := oauth.Fields[sourceType]
	if ok {
		if clientId, ok := oathFields["client_id"]; gac.ClientID == "" && ok {
			gac.ClientID = viper.GetString(clientId)
		}
		if clientSecret, ok := oathFields["client_secret"]; gac.ClientSecret == "" && ok {
			gac.ClientSecret = viper.GetString(clientSecret)
		}
	}
}

//Validate checks service account JSON or OAuth fields
//returns err if both authorization parameters are empty
func (gac *GoogleAuthConfig) Validate() error {
	if gac.Type == GoogleOAuthAuthorizationType {
		//validate OAuth field
		if gac.ClientID == "" {
			return errors.New("'client_id' is required for Google OAuth authorization")
		}
		if gac.ClientSecret == "" {
			return errors.New("'client_secret' is required for Google OAuth authorization")
		}
		if gac.RefreshToken == "" {
			return errors.New("'refresh_token' is required for Google OAuth authorization")
		}

		return nil
	}

	if gac.ServiceAccountKey == nil || fmt.Sprint(gac.ServiceAccountKey) == "{}" {
		return errors.New("Google authorization is not configured. Plesae configure [service_account_key] field or [client_id, client_secret, refresh_token] set of fields")
	}

	return nil
}

//GoogleAuthorizedUserJSON is a Google dto for authorization
type GoogleAuthorizedUserJSON struct {
	ClientID     string `mapstructure:"client_id" json:"client_id,omitempty" yaml:"client_id,omitempty"`
	ClientSecret string `mapstructure:"client_secret" json:"client_secret,omitempty" yaml:"client_secret,omitempty"`
	RefreshToken string `mapstructure:"refresh_token" json:"refresh_token,omitempty" yaml:"refresh_token,omitempty"`
	AuthType     string `mapstructure:"type" json:"type,omitempty" yaml:"type,omitempty"`
}

//ToGoogleAuthJSON returns configured GoogleAuthorizedUserJSON structure for Google authorization
func (gac *GoogleAuthConfig) ToGoogleAuthJSON() GoogleAuthorizedUserJSON {
	return GoogleAuthorizedUserJSON{
		ClientID:     gac.ClientID,
		ClientSecret: gac.ClientSecret,
		RefreshToken: gac.RefreshToken,
		AuthType:     "authorized_user",
	}
}

//Driver interface must be implemented by every source type
type Driver interface {
	io.Closer
	//GetAllAvailableIntervals return all the available time intervals for data loading. It means, that if you want
	//your driver to load for the last year by month chunks, you need to return 12 time intervals, each covering one
	//month. There is drivers/granularity.ALL for data sources that store data which may not be split by date.
	GetAllAvailableIntervals() ([]*TimeInterval, error)

	//GetRefreshWindow return times duration during which Jitsu will keep reloading stream data.
	//Necessary for Sources where data may change retroactively (analytics, ads)
	GetRefreshWindow() (time.Duration, error)

	/*GetObjectsFor returns slice of objects per time interval. Each slice element is one object from the data source.
	pos - current position (object number)
	total - number of objects available to load. -1 is there is no way to know exact number in advance
	percent - percent of total object processed [0..100]. estimated value when there is no way to know exact number in advance*/
	GetObjectsFor(interval *TimeInterval, objectsLoader ObjectsLoader) error

	//Type returns string type of driver. Should be unique among drivers
	Type() string

	//GetCollectionTable returns table name
	GetCollectionTable() string

	//GetCollectionMetaKey returns key for storing signature in meta.Storage
	GetCollectionMetaKey() string

	//GetDriversInfo returns telemetry information about the driver
	GetDriversInfo() *DriversInfo

	Delete() error
}

//CLIDriver interface must be implemented by every CLI source type (Singer or Airbyte)
type CLIDriver interface {
	Driver

	//IsClosed returns true if the driver is already closed
	IsClosed() bool
	//Load runs CLI command and consumes output
	Load(config string, state string, taskLogger logging.TaskLogger, dataConsumer CLIDataConsumer, taskCloser CLITaskCloser) error
	//Ready returns true if the driver is ready otherwise returns ErrNotReady
	Ready() (bool, error)
	//GetTap returns npm package for sdk_source, Singer tap or airbyte docker image (without prefix 'airbyte/': source-mixpanel)
	GetTap() string
	//GetTableNamePrefix returns stream table name prefix or sourceID_
	GetTableNamePrefix() string
	//GetStreamTableNameMapping returns stream - table name mappings from configuration
	GetStreamTableNameMapping() map[string]string
	//GetTap returns path to config file
	GetConfigPath() string
}

//CLIDataConsumer is used for consuming CLI drivers output
type CLIDataConsumer interface {
	Consume(representation *CLIOutputRepresentation) error
}

//CLITaskCloser is used for closing tasks
type CLITaskCloser interface {
	TaskID() string
	CloseWithError(msg string, systemErr bool)
	HandleCanceling() error
}

//CLIOutputRepresentation is a singer/airbyte output representation
type CLIOutputRepresentation struct {
	State interface{}
	//[some key for convenience of grouping.] - {}
	Streams map[string]*StreamRepresentation
}

//StreamRepresentation is a singer/airbyte stream representation
type StreamRepresentation struct {
	Namespace             string
	StreamName            string
	BatchHeader           *schema.BatchHeader
	KeyFields             []string
	Objects               []map[string]interface{}
	KeepKeysUnhashed      bool
	RemoveSourceKeyFields bool
	NeedClean             bool
	DeleteConditions      *adapters.DeleteConditions
}

//DriversInfo is a dto for sharing information about the driver into telemetry
type DriversInfo struct {
	SourceType       string
	ConnectorOrigin  string
	ConnectorVersion string
	Streams          int
}

//RegisterDriver registers function to create new driver instance
func RegisterDriver(driverType string,
	createDriverFunc func(ctx context.Context, config *SourceConfig, collection *Collection) (Driver, error)) {
	DriverConstructors[driverType] = createDriverFunc
}

//RegisterTestConnectionFunc registers function to test driver connection
func RegisterTestConnectionFunc(driverType string, testConnectionFunc func(config *SourceConfig) error) {
	DriverTestConnectionFuncs[driverType] = testConnectionFunc
}

//WaitReadiness waits 90 sec until driver is ready or returns false and notReadyError
func WaitReadiness(driver CLIDriver, taskLogger logging.TaskLogger) (bool, error) {
	ready, _ := driver.Ready()

	if ready {
		return true, nil
	}

	seconds := 0
	for seconds < 90 {
		if driver.IsClosed() {
			return false, fmt.Errorf("%s already has been closed", driver.Type())
		}

		ready, _ := driver.Ready()
		if ready {
			return true, nil
		}

		taskLogger.WARN("waiting for source driver being ready..")
		time.Sleep(10 * time.Second)
		seconds += 10
	}

	return driver.Ready()
}
