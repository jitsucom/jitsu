package system

import (
	"encoding/json"
	"sync"
	"time"

	"github.com/jitsucom/jitsu/server/resources"
)

const serviceName = "system"

var reloadEvery = 5 * time.Second

// Configuration is used for system endpoint in Configurator and for Server redirect when configured
// provides current authorization configuration and amount of registered users
type Configuration struct {
	Authorization               string `json:"authorization"`
	SSOAuthLink                 string `json:"sso_auth_link"`
	Users                       bool   `json:"users"`
	SMTP                        bool   `json:"smtp"`
	SelfHosted                  bool   `json:"selfhosted"`
	SupportWidget               bool   `json:"support_widget"`
	DefaultS3Bucket             bool   `json:"default_s3_bucket"`
	SupportTrackingDomains      bool   `json:"support_tracking_domains"`
	TelemetryUsageDisabled      bool   `json:"telemetry_usage_disabled"`
	DockerHubID                 string `json:"docker_hub_id"`
	OnlyAdminCanChangeUserEmail bool   `json:"only_admin_can_change_user_email"`
	ServerPublicUrl             string `json:"server_public_url"`
	PluginScript                string `json:"plugin_script"`
	Tag                         string `json:"tag"`
	BuiltAt                     string `json:"built_at"`
}

// Service is a reloadable service for keeping system configuration
type Service struct {
	mutex         *sync.RWMutex
	configuration *Configuration

	configured bool
}

// NewService returns configured Service and call resources.Watcher()
func NewService(url string) *Service {
	if url == "" {
		return &Service{}
	}

	service := &Service{configured: true, mutex: &sync.RWMutex{}}
	resources.Watch(serviceName, url, resources.LoadFromHTTP, service.reInit, reloadEvery)
	return service
}

// reInit initializes system configuration
// it is used for keeping actual configuration for configurator redirect
func (s *Service) reInit(payload []byte) {
	c := &Configuration{}
	err := json.Unmarshal(payload, c)
	if err != nil {
		return
	}

	s.mutex.Lock()
	s.configuration = c
	s.mutex.Unlock()
}

func (s *Service) ShouldBeRedirected() bool {
	return s.configured && !s.configuration.Users
}

func (s *Service) IsConfigured() bool {
	return s.configured
}
