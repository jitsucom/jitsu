package geo

import "errors"

const (
	MaxmindType = "maxmind"
	DummyType   = "dummy"

	UKCountry = "UK"
)

var (
	EmptyIP = errors.New("IP is empty")

	EUCountries = map[string]bool{
		"BE": true,
		"EL": true,
		"LT": true,
		"PT": true,
		"BG": true,
		"ES": true,
		"LU": true,
		"RO": true,
		"CZ": true,
		"FR": true,
		"HU": true,
		"SI": true,
		"DK": true,
		"HR": true,
		"MT": true,
		"SK": true,
		"DE": true,
		"IT": true,
		"NL": true,
		"FI": true,
		"EE": true,
		"CY": true,
		"AT": true,
		"SE": true,
		"IE": true,
		"LV": true,
		"PL": true,
	}
)

//Resolver is a geo based location data resolver
type Resolver interface {
	Resolve(ip string) (*Data, error)
	Type() string
	Close() error
}

//Data is a geo location data dto
type Data struct {
	Continent   string  `json:"continent,omitempty"`
	Country     string  `json:"country,omitempty"`
	CountryName string  `json:"country_name,omitempty"`
	City        string  `json:"city,omitempty"`
	Lat         float64 `json:"latitude,omitempty"`
	Lon         float64 `json:"longitude,omitempty"`
	Zip         string  `json:"zip,omitempty"`
	Region      string  `json:"region,omitempty"`

	ASN          uint   `json:"autonomous_system_number,omitempty"`
	ASO          string `json:"autonomous_system_organization,omitempty"`
	ISP          string `json:"isp,omitempty"`
	Organization string `json:"organization,omitempty"`
	Domain       string `json:"domain,omitempty"`
}

//ResolverConfig is a dto for geo data resolver config serialization
type ResolverConfig struct {
	Type   string      `mapstructure:"type" json:"type,omitempty" yaml:"type,omitempty"`
	Config interface{} `mapstructure:"config" json:"config,omitempty" yaml:"config,omitempty"`
}

//MaxMindConfig is a dto for MaxMind configuration serialization
type MaxMindConfig struct {
	MaxMindURL string `mapstructure:"maxmind_url" json:"maxmind_url,omitempty" yaml:"maxmind_url,omitempty"`
}
