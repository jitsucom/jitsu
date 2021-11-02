package geo

import "errors"

const (
	//paid databases
	GeoIP2CityEdition    Edition = "GeoIP2-City"
	GeoIP2ISPEdition     Edition = "GeoIP2-ISP"
	GeoIP2DomainEdition  Edition = "GeoIP2-Domain"
	GeoIP2CountryEdition Edition = "GeoIP2-Country"

	//free databases
	GeoLite2CityEdition    Edition = "GeoLite2-City"
	GeoLite2CountryEdition Edition = "GeoLite2-Country"
	GeoLite2ASNEdition     Edition = "GeoLite2-ASN"

	Unknown Edition = ""
)

type Edition string

//FreeAnalog returns free database analog of the current
func (e Edition) FreeAnalog() Edition {
	switch e {
	case GeoIP2CityEdition:
		return GeoLite2CityEdition
	case GeoIP2ISPEdition:
		return GeoLite2ASNEdition
	case GeoIP2CountryEdition:
		return GeoLite2CountryEdition
	default:
		return Unknown
	}
}

func (e Edition) String() string {
	return string(e)
}

func fromString(value string) (Edition, error) {
	switch value {
	case GeoIP2CityEdition.String():
		return GeoIP2CityEdition, nil
	case GeoIP2ISPEdition.String():
		return GeoIP2ISPEdition, nil
	case GeoIP2DomainEdition.String():
		return GeoIP2DomainEdition, nil
	case GeoIP2CountryEdition.String():
		return GeoIP2CountryEdition, nil
	case GeoLite2CityEdition.String():
		return GeoLite2CityEdition, nil
	case GeoLite2ASNEdition.String():
		return GeoLite2ASNEdition, nil
	case GeoLite2CountryEdition.String():
		return GeoLite2CountryEdition, nil
	default:
		return Unknown, errors.New("unknown maxmind edition")
	}
}
