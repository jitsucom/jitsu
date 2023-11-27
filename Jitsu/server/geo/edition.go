package geo

import (
	"fmt"
	"strings"
)

const (
	//paid editions
	GeoIP2CountryEdition Edition = "GeoIP2-Country"
	GeoIP2CityEdition    Edition = "GeoIP2-City"
	GeoIP2ISPEdition     Edition = "GeoIP2-ISP"
	GeoIP2DomainEdition  Edition = "GeoIP2-Domain"

	//free editions
	GeoLite2CityEdition    Edition = "GeoLite2-City"
	GeoLite2CountryEdition Edition = "GeoLite2-Country"
	GeoLite2ASNEdition     Edition = "GeoLite2-ASN"

	Unknown     Edition = ""
	NotRequired Edition = "NotRequired"
)

var paidEditions = []Edition{GeoIP2CountryEdition, GeoIP2CityEdition, GeoIP2ISPEdition, GeoIP2DomainEdition}

type Edition string

//FreeAnalog returns free database analog of the current
//add this to EditionRules as well
func (e Edition) FreeAnalog() Edition {
	switch e {
	case GeoIP2CityEdition:
		return GeoLite2CityEdition
	case GeoIP2ISPEdition:
		return GeoLite2ASNEdition
	case GeoIP2CountryEdition:
		return GeoLite2CountryEdition
	case GeoIP2DomainEdition:
		return NotRequired
	default:
		return Unknown
	}
}

func (e Edition) String() string {
	return string(e)
}

func fromString(value string) (Edition, error) {
	formattedValue := strings.ToLower(strings.TrimSpace(value))
	switch formattedValue {
	case strings.ToLower(GeoIP2CityEdition.String()):
		return GeoIP2CityEdition, nil
	case strings.ToLower(GeoIP2ISPEdition.String()):
		return GeoIP2ISPEdition, nil
	case strings.ToLower(GeoIP2DomainEdition.String()):
		return GeoIP2DomainEdition, nil
	case strings.ToLower(GeoIP2CountryEdition.String()):
		return GeoIP2CountryEdition, nil
	case strings.ToLower(GeoLite2CityEdition.String()):
		return GeoLite2CityEdition, nil
	case strings.ToLower(GeoLite2ASNEdition.String()):
		return GeoLite2ASNEdition, nil
	case strings.ToLower(GeoLite2CountryEdition.String()):
		return GeoLite2CountryEdition, nil
	default:
		return Unknown, fmt.Errorf("unknown maxmind edition: '%s' (formatted: '%s'", value, formattedValue)
	}
}
