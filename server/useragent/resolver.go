package useragent

import (
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/ua-parser/uap-go/uaparser"
	"strings"
)

// ParsedUaKey is a json key for parsed user-agent data object
const ParsedUaKey = "parsed_ua"

var BotUAKeywords = []string{"bot", "spider", "headless", "crawler", "uptimia"}

// Resolver performs user-agent string parsing into ResolvedUa struct
// can be mocked
type Resolver interface {
	Resolve(ua string) *ResolvedUa
}

// UaResolver parses user-agent strings into ResolvedUa structures with "github.com/ua-parser/uap-go/uaparser"
type UaResolver struct {
	parser        *uaparser.Parser
	botUAKeywords []string
}

// NewResolver returns new instance of UaResolver
func NewResolver(extraBotUaKeywords []string) Resolver {
	botUAKeywords := make([]string, 0, len(BotUAKeywords)+len(extraBotUaKeywords))
	botUAKeywords = append(botUAKeywords, BotUAKeywords...)
	botUAKeywords = append(botUAKeywords, extraBotUaKeywords...)
	return &UaResolver{parser: uaparser.NewFromSaved(), botUAKeywords: botUAKeywords}
}

// ResolvedUa model for keeping resolved user-agent data
type ResolvedUa struct {
	UaFamily  string `mapstructure:"ua_family,omitempty" json:"ua_family,omitempty"`
	UaVersion string `mapstructure:"ua_version,omitempty" json:"ua_version,omitempty"`

	OsFamily  string `mapstructure:"os_family,omitempty" json:"os_family,omitempty"`
	OsVersion string `mapstructure:"os_version,omitempty" json:"os_version,omitempty"`

	DeviceFamily string `mapstructure:"device_family,omitempty" json:"device_family,omitempty"`
	DeviceBrand  string `mapstructure:"device_brand,omitempty" json:"device_brand,omitempty"`
	DeviceModel  string `mapstructure:"device_model,omitempty" json:"device_model,omitempty"`

	Bot bool `mapstructure:"bot,omitempty" json:"bot,omitempty"`
}

// IsEmpty returns true if all values in ResolvedUa is empty
func (rua ResolvedUa) IsEmpty() bool {
	return rua.UaFamily == "" && rua.UaVersion == "" &&
		rua.OsFamily == "" && rua.OsVersion == "" &&
		rua.DeviceFamily == "" && rua.DeviceBrand == "" && rua.DeviceModel == ""
}

// Resolve client user-agent with github.com/ua-parser/uap-go/uaparser lib
// Return nil if parsed ua is empty
func (r *UaResolver) Resolve(ua string) *ResolvedUa {
	if ua == "" {
		return nil
	}

	parsed := r.parser.Parse(ua)
	if parsed == nil {
		logging.Error("Unable to parse user agent:", ua)
		return nil
	}

	resolved := &ResolvedUa{}
	if parsed.UserAgent != nil {
		if parsed.UserAgent.Family != "Other" {
			resolved.UaFamily = parsed.UserAgent.Family
		}

		resolved.UaVersion = parsed.UserAgent.ToVersionString()
	}

	if parsed.Os != nil {
		if parsed.Os.Family != "Other" {
			resolved.OsFamily = parsed.Os.Family
		}
		resolved.OsVersion = parsed.Os.ToVersionString()
	}

	if parsed.Device != nil {
		if parsed.Device.Family != "Other" {
			resolved.DeviceFamily = parsed.Device.Family
		}
		resolved.DeviceBrand = parsed.Device.Brand
		resolved.DeviceModel = parsed.Device.Model
	}

	if resolved.IsEmpty() {
		return nil
	}

	ual := strings.ToLower(ua)
	if resolved.DeviceFamily == "Spider" || resolved.DeviceBrand == "Spider" {
		resolved.Bot = true
	} else {
		for _, keyword := range r.botUAKeywords {
			if strings.Contains(ual, keyword) {
				resolved.Bot = true
				break
			}
		}
	}

	return resolved
}
