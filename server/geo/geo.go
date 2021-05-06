package geo

import (
	"errors"
	"fmt"
	"io/ioutil"
	"net"
	"net/http"
	"path"
	"strings"

	"github.com/jitsucom/jitsu/server/logging"
	"github.com/oschwald/geoip2-golang"
)

var (
	EmptyIP    = errors.New("IP is empty")
	mmdbSuffix = ".mmdb"
)

type Resolver interface {
	Resolve(ip string) (*Data, error)
}

type Data struct {
	Country string  `json:"country,omitempty"`
	City    string  `json:"city,omitempty"`
	Lat     float64 `json:"latitude,omitempty"`
	Lon     float64 `json:"longitude,omitempty"`
	Zip     string  `json:"zip,omitempty"`
	Region  string  `json:"region,omitempty"`
}

type MaxMindResolver struct {
	parser *geoip2.Reader
}

type DummyResolver struct{}

func CreateResolver(geoipPath string) (Resolver, error) {
	geoIPParser, err := createGeoIPParser(geoipPath)
	if err != nil {
		return &DummyResolver{}, fmt.Errorf("Error open maxmind db: %v", err)
	}

	resolver := &MaxMindResolver{}
	resolver.parser = geoIPParser

	return resolver, nil
}

//Create maxmind geo resolver from http source or from local file
func createGeoIPParser(geoipPath string) (*geoip2.Reader, error) {
	if strings.Contains(geoipPath, "http://") || strings.Contains(geoipPath, "https://") {
		logging.Info("Start downloading maxmind from", geoipPath)
		r, err := http.Get(geoipPath)
		if err != nil {
			return nil, fmt.Errorf("Error loading maxmind db from http source: %s %v", geoipPath, err)
		}
		defer r.Body.Close()

		b, err := ioutil.ReadAll(r.Body)
		if err != nil {
			return nil, fmt.Errorf("Error reading maxmind db from http source: %s %v", geoipPath, err)
		}

		return geoip2.FromBytes(b)
	} else {
		var geoipFilePath string
		if strings.HasSuffix(geoipPath, mmdbSuffix) {
			geoipFilePath = geoipPath
		} else {
			geoipFilePath = findMmdbFile(geoipPath)
			if geoipFilePath == "" {
				return nil, fmt.Errorf("Cannot find maxmind db in directory: %s", geoipPath)
			}
		}
		return geoip2.Open(geoipFilePath)
	}
}

//Resolve returns location info parsed from client ip address
func (mr *MaxMindResolver) Resolve(ip string) (*Data, error) {
	data := &Data{}
	if ip == "" {
		return nil, EmptyIP
	}

	city, err := mr.parser.City(net.ParseIP(ip))
	if err != nil {
		return nil, fmt.Errorf("Error parsing geo from ip %s: %v", ip, err)
	}

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

	return data, nil
}

func (dr *DummyResolver) Resolve(ip string) (*Data, error) {
	return nil, nil
}

func findMmdbFile(dir string) string {
	files, err := ioutil.ReadDir(dir)
	if err != nil {
		return ""
	}

	for _, f := range files {
		if strings.HasSuffix(f.Name(), mmdbSuffix) {
			return path.Join(dir, f.Name())
		}
	}

	return ""
}
