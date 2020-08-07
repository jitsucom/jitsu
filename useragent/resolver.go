package useragent

import (
	"fmt"
	"github.com/ua-parser/uap-go/uaparser"
	"log"
)

const ParsedUaKey = "parsed_ua"

type Resolver struct {
	parser *uaparser.Parser
}

func NewResolver() *Resolver {
	return &Resolver{parser: uaparser.NewFromSaved()}
}

type ResolvedUa struct {
	UaFamily  string `json:"ua_family,omitempty"`
	UaVersion string `json:"ua_version,omitempty"`

	OsFamily  string `json:"os_family,omitempty"`
	OsVersion string `json:"os_version,omitempty"`

	DeviceFamily string `json:"device_family,omitempty"`
	DeviceBrand  string `json:"device_brand,omitempty"`
	DeviceModel  string `json:"device_model,omitempty"`
}

func (rua ResolvedUa) IsEmpty() bool {
	return rua.UaFamily == "" && rua.UaVersion == "" &&
		rua.OsFamily == "" && rua.OsVersion == "" &&
		rua.DeviceFamily == "" && rua.DeviceBrand == "" && rua.DeviceModel == ""
}

func (r Resolver) Resolve(ua string) *ResolvedUa {
	if ua == "" {
		return nil
	}

	parsed := r.parser.Parse(ua)
	if parsed == nil {
		log.Println("Unable to parse user agent:", ua)
		return nil
	}

	resolved := &ResolvedUa{}
	if parsed.UserAgent != nil {
		if parsed.UserAgent.Family != "Other" {
			resolved.UaFamily = parsed.UserAgent.Family
		}
		uaVersion := fmt.Sprintf("%s.%s.%s", parsed.UserAgent.Major, parsed.UserAgent.Minor, parsed.UserAgent.Patch)
		if uaVersion != ".." {
			resolved.UaVersion = uaVersion
		}
	}

	if parsed.Os != nil {
		if parsed.Os.Family != "Other" {
			resolved.OsFamily = parsed.Os.Family
		}
		osVersion := fmt.Sprintf("%s.%s.%s", parsed.Os.Major, parsed.Os.Minor, parsed.Os.Patch)
		if osVersion != ".." {
			resolved.OsVersion = osVersion
		}
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

	return resolved
}
