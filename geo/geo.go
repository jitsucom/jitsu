package geo

import (
	"errors"
	"fmt"
	"github.com/oschwald/geoip2-golang"
	"io/ioutil"
	"net"
	"net/http"
	"strings"

	"log"
)

const GeoDataKey = "location"

var (
	EmptyIp    = errors.New("IP is empty")
	mmdbSuffix = ".mmdb"
)

type Resolver interface {
	Resolve(ip string) (*Data, error)
}

type Data struct {
	Country string  `json:"country"`
	City    string  `json:"city"`
	Lat     float64 `json:"latitude"`
	Lon     float64 `json:"longitude"`
	Zip     string  `json:"zip"`
	Region  string  `json:"region"`
}

type MaxMindResolver struct {
	parser *geoip2.Reader
}

type DummyResolver struct{}

func CreateResolver(geoipPath string) (Resolver, error) {
	if geoipPath == "" {
		return &DummyResolver{}, errors.New("Maxmind db source wasn't provided")
	}

	geoIpParser, err := createGeoIpParser(geoipPath)
	if err != nil {
		log.Println("Error open maxmind db ", err)
		return &DummyResolver{}, err
	}

	resolver := &MaxMindResolver{}
	resolver.parser = geoIpParser
	log.Println("Loaded MaxMind db:", geoipPath)

	return resolver, nil
}

func createGeoIpParser(geoipPath string) (*geoip2.Reader, error) {
	if strings.Contains(geoipPath, "http://") || strings.Contains(geoipPath, "https://") {
		log.Println("Start downloading maxmind from", geoipPath)
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
		if !strings.HasSuffix(geoipPath, mmdbSuffix) {
			geoipPath = findMmdbFile(geoipPath)
		}

		return geoip2.Open(geoipPath)
	}
}

func (mr *MaxMindResolver) Resolve(ip string) (*Data, error) {
	data := &Data{}
	if ip == "" {
		return nil, EmptyIp
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

func findMmdbFile(path string) string {
	files, err := ioutil.ReadDir(path)
	if err != nil {
		log.Println(err)
		return ""
	}

	for _, f := range files {
		if strings.HasSuffix(f.Name(), mmdbSuffix) {
			if !strings.HasSuffix(path, "/") {
				path = path + "/"
			}
			return path + f.Name()
		}
	}

	return ""
}
