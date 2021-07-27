package base

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/ioutil"
	"strings"
)

const (
	AmplitudeType       = "amplitude"
	FbMarketingType     = "facebook_marketing"
	FirebaseType        = "firebase"
	GoogleAnalyticsType = "google_analytics"
	GooglePlayType      = "google_play"
	RedisType           = "redis"

	SingerType = "singer"

	GoogleOAuthAuthorizationType = "OAuth"

	DefaultDaysBackToLoad = 365
)

var (
	DriverConstructors         = make(map[string]func(ctx context.Context, config *SourceConfig, collection *Collection) (Driver, error))
	DriverTestConnectionFuncs  = make(map[string]func(config *SourceConfig) error)
	errAccountKeyConfiguration = errors.New("service_account_key must be an object, JSON file path or JSON content string")
)

type GoogleAuthConfig struct {
	Type              string      `mapstructure:"type" json:"type,omitempty" yaml:"type,omitempty"`
	ClientID          string      `mapstructure:"client_id" json:"client_id,omitempty" yaml:"client_id,omitempty"`
	ClientSecret      string      `mapstructure:"client_secret" json:"client_secret,omitempty" yaml:"client_secret,omitempty"`
	RefreshToken      string      `mapstructure:"refresh_token" json:"refresh_token,omitempty" yaml:"refresh_token,omitempty"`
	ServiceAccountKey interface{} `mapstructure:"service_account_key" json:"service_account_key,omitempty" yaml:"service_account_key,omitempty"`
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
	//GetObjectsFor returns slice of objects per time interval. Each slice element is one object from the data source.
	GetObjectsFor(interval *TimeInterval) ([]map[string]interface{}, error)
	//Type returns string type of driver. Should be unique among drivers
	Type() string
	//GetCollectionTable returns table name
	GetCollectionTable() string
	//GetCollectionMetaKey returns key for storing signature in meta.Storage
	GetCollectionMetaKey() string
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

//UnmarshalConfig serializes and deserializes config into the object
//return error if occurred
func UnmarshalConfig(config interface{}, object interface{}) error {
	b, err := json.Marshal(config)
	if err != nil {
		return fmt.Errorf("error marshalling object: %v", err)
	}
	err = json.Unmarshal(b, object)
	if err != nil {
		return fmt.Errorf("Error unmarshalling config: %v", err)
	}

	return nil
}
