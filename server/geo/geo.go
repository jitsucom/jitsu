package geo

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"errors"
	"fmt"
	"io"
	"io/ioutil"
	"net"
	"net/http"
	"path"
	"strings"

	"github.com/jitsucom/jitsu/server/logging"
	"github.com/oschwald/geoip2-golang"
)

const (
	mmdbSuffix = ".mmdb"

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
}

//Data is a geo location data dto
type Data struct {
	Country string  `json:"country,omitempty"`
	City    string  `json:"city,omitempty"`
	Lat     float64 `json:"latitude,omitempty"`
	Lon     float64 `json:"longitude,omitempty"`
	Zip     string  `json:"zip,omitempty"`
	Region  string  `json:"region,omitempty"`
}

//MaxMindResolver is a geo location data Resolver that is based on MaxMind DB data
type MaxMindResolver struct {
	parser *geoip2.Reader
}

//DummyResolver is a dummy resolver that does nothing and returns empty geo data
type DummyResolver struct{}

//CreateResolver returns geo MaxMind Resolver
func CreateResolver(maxmindDownloadURLTemplate, geoipPath string) (Resolver, error) {
	geoIPParser, err := loadAndCreateGeoIPParser(maxmindDownloadURLTemplate, geoipPath)
	if err != nil {
		return &DummyResolver{}, fmt.Errorf("Error open maxmind db: %v", err)
	}

	resolver := &MaxMindResolver{}
	resolver.parser = geoIPParser

	return resolver, nil
}

//loadAndCreateGeoIPParser creates maxmind geo resolver from:
// HTTP Custom source
// HTTP MaxMind official source
// local file
func loadAndCreateGeoIPParser(maxmindDownloadURLTemplate, geoipPath string) (*geoip2.Reader, error) {
	//load from custom HTTP source
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

		reader, firstErr := geoip2.FromBytes(b)
		if firstErr != nil {
			//try to read tar.gz
			payloadFromTarGz, err := extractMaxMindDBFromTarGz(bytes.NewBuffer(b))
			if err != nil {
				return nil, firstErr
			}

			return geoip2.FromBytes(payloadFromTarGz)
		}

		return reader, nil
	} else if strings.Contains(geoipPath, "maxmind://") {
		//load from official MaxMind HTTP source
		maxmindDBURL := fmt.Sprintf(maxmindDownloadURLTemplate, strings.TrimSpace(strings.ReplaceAll(geoipPath, "maxmind://", "")))
		logging.Info("Start downloading maxmind from", maxmindDBURL)

		r, err := http.Get(maxmindDBURL)
		if err != nil {
			return nil, fmt.Errorf("Error loading maxmind db from MaxMind URL [%s]: %v", maxmindDBURL, err)
		}
		defer r.Body.Close()

		b, err := extractMaxMindDBFromTarGz(r.Body)
		if err != nil {
			return nil, fmt.Errorf("Error reading maxmind db from MaxMind URL [%s]: %v", maxmindDBURL, err)
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

func (mr *MaxMindResolver) Type() string {
	return MaxmindType
}

func (dr *DummyResolver) Resolve(ip string) (*Data, error) {
	return nil, nil
}

func (dr *DummyResolver) Type() string {
	return DummyType
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

func extractMaxMindDBFromTarGz(gzipStream io.Reader) ([]byte, error) {
	uncompressedStream, err := gzip.NewReader(gzipStream)
	if err != nil {
		return nil, fmt.Errorf("error creating new gzip reader: %v", err)
	}

	tarReader := tar.NewReader(uncompressedStream)

	for {
		header, err := tarReader.Next()

		if err == io.EOF {
			break
		}

		if err != nil {
			return nil, fmt.Errorf("error extracting tar.gz: %v", err)
		}

		switch header.Typeflag {
		case tar.TypeReg:
			if strings.HasSuffix(header.Name, mmdbSuffix) {
				maxmindDBBytes, err := ioutil.ReadAll(tarReader)
				if err != nil {
					return nil, fmt.Errorf("error reading from downloaded maxmind file: %v", err)
				}

				return maxmindDBBytes, nil
			}

		default:
		}
	}

	return nil, fmt.Errorf("MaxMind DB (file with %s suffix) wasn't found", mmdbSuffix)
}
