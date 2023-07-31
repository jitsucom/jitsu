package geo

import (
	"fmt"
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/oschwald/geoip2-golang"
	"net"
)

//MaxMindResolver is a geo location data Resolver that is based on MaxMind DB data
type MaxMindResolver struct {
	cityParser    *geoip2.Reader
	countryParser *geoip2.Reader
	ispParser     *geoip2.Reader
	asnParser     *geoip2.Reader
	domainParser  *geoip2.Reader
}

func newFromParser(parser *geoip2.Reader) (*MaxMindResolver, error) {
	edition, err := fromString(parser.Metadata().DatabaseType)
	if err != nil {
		return nil, err
	}

	mmr := &MaxMindResolver{}
	mmr.setParser(parser, edition)
	return mmr, nil
}

func (mmr *MaxMindResolver) setParser(parser *geoip2.Reader, edition Edition) {
	switch edition {
	case GeoIP2CityEdition, GeoLite2CityEdition:
		mmr.cityParser = parser
	case GeoIP2CountryEdition, GeoLite2CountryEdition:
		mmr.countryParser = parser
	case GeoIP2ISPEdition:
		mmr.ispParser = parser
	case GeoIP2DomainEdition:
		mmr.domainParser = parser
	case GeoLite2ASNEdition:
		mmr.asnParser = parser
	default:
		logging.SystemErrorf("Unknown edition field in geo resolver: %s", edition)
	}
}

//Resolve returns location geo data (city, asn, domain) parsed from client ip address
func (mmr *MaxMindResolver) Resolve(ip string) (*Data, error) {
	data := &Data{}
	if ip == "" {
		return nil, EmptyIP
	}

	parsedIP := net.ParseIP(ip)
	if parsedIP == nil {
		return nil, fmt.Errorf("Error parsing IP from string: %s", ip)
	}

	if mmr.countryParser != nil {
		country, err := mmr.countryParser.Country(parsedIP)
		if err != nil {
			return nil, fmt.Errorf("Error parsing country geo from ip %s: %v", ip, err)
		}

		data.Continent = country.Continent.Names["en"]
		data.Country = country.Country.IsoCode
		data.CountryName = country.Country.Names["en"]
	}

	if mmr.cityParser != nil {
		city, err := mmr.cityParser.City(parsedIP)
		if err != nil {
			return nil, fmt.Errorf("Error parsing city geo from ip %s: %v", ip, err)
		}

		data.Continent = city.Continent.Names["en"]
		data.CountryName = city.Country.Names["en"]
		data.Country = city.Country.IsoCode
		data.City = city.City.Names["en"]
		data.Lat = city.Location.Latitude
		data.Lon = city.Location.Longitude
		data.Zip = city.Postal.Code

		if len(city.Subdivisions) > 0 {
			if city.Country.IsoCode == "RU" {
				data.Region = fmt.Sprintf("%s-%s", city.Country.IsoCode, city.Subdivisions[0].IsoCode)
			} else {
				data.Region = city.Subdivisions[0].IsoCode
			}
		}
	}

	if mmr.ispParser != nil {
		isp, err := mmr.ispParser.ISP(parsedIP)
		if err != nil {
			return nil, fmt.Errorf("Error parsing isp geo from ip %s: %v", ip, err)
		}

		data.ASN = isp.AutonomousSystemNumber
		data.ASO = isp.AutonomousSystemOrganization
		data.Organization = isp.Organization
	}

	if mmr.asnParser != nil {
		asn, err := mmr.asnParser.ASN(parsedIP)
		if err != nil {
			return nil, fmt.Errorf("Error parsing asn geo from ip %s: %v", ip, err)
		}

		data.ASN = asn.AutonomousSystemNumber
		data.ASO = asn.AutonomousSystemOrganization
	}

	if mmr.domainParser != nil {
		dom, err := mmr.domainParser.Domain(parsedIP)
		if err != nil {
			return nil, fmt.Errorf("Error parsing domain geo from ip %s: %v", ip, err)
		}

		data.Domain = dom.Domain
	}

	return data, nil
}

func (mmr *MaxMindResolver) Type() string {
	return MaxmindType
}

//Close closes all parsers
func (mmr *MaxMindResolver) Close() (multiErr error) {
	if mmr.cityParser != nil {
		if err := mmr.cityParser.Close(); err != nil {
			multiErr = multierror.Append(multiErr, err)
		}
	}

	if mmr.countryParser != nil {
		if err := mmr.countryParser.Close(); err != nil {
			multiErr = multierror.Append(multiErr, err)
		}
	}

	if mmr.ispParser != nil {
		if err := mmr.ispParser.Close(); err != nil {
			multiErr = multierror.Append(multiErr, err)
		}
	}

	if mmr.asnParser != nil {
		if err := mmr.asnParser.Close(); err != nil {
			multiErr = multierror.Append(multiErr, err)
		}
	}

	if mmr.domainParser != nil {
		if err := mmr.domainParser.Close(); err != nil {
			multiErr = multierror.Append(multiErr, err)
		}
	}

	return
}
