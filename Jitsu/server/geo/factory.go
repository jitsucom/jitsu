package geo

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/oschwald/geoip2-golang"
	"io"
	"io/ioutil"
	"net/http"
	"path"
	"strings"
)

const (
	mmdbSuffix    = ".mmdb"
	MaxmindPrefix = "maxmind://"
)

var (
	ErrInvalidLicenseKey   = errors.New("Invalid license key")
	ErrMaxmindFileNotFound = fmt.Errorf("MaxMind DB (file with %s suffix) wasn't found", mmdbSuffix)
)

//MaxMindFactory is responsible for creation geo resolvers from
type MaxMindFactory struct {
	officialDownloadURLTemplate string
}

func NewMaxmindFactory(officialDownloadURLTemplate string) *MaxMindFactory {
	return &MaxMindFactory{officialDownloadURLTemplate: officialDownloadURLTemplate}
}

//Test tries to download all MaxMind databases and returns all available Edition
//or error if no editions are available
func (f *MaxMindFactory) Test(maxmindURL string) ([]*EditionRule, error) {
	licenseKey, editions, err := f.parseMaxmindAddress(maxmindURL)
	if err != nil {
		return nil, err
	}

	//use all paid editions by default
	if len(editions) == 0 {
		editions = paidEditions
	}

	var editionsResult []*EditionRule
	for _, edition := range editions {
		rule := &EditionRule{}

		//main
		url := fmt.Sprintf(f.officialDownloadURLTemplate, licenseKey, edition)
		if err := checkPermissions(url); err != nil {
			rule.Main = &EditionData{
				Name:    edition,
				Status:  StatusError,
				Message: err.Error(),
			}
		} else {
			rule.Main = &EditionData{
				Name:   edition,
				Status: StatusOK,
			}
		}

		//analog
		analog := edition.FreeAnalog()
		if analog != Unknown && analog != NotRequired {
			rule.Analog = &EditionData{
				Name:   analog,
				Status: StatusUnknown,
			}

			if rule.Main.Status == StatusError {
				url = fmt.Sprintf(f.officialDownloadURLTemplate, licenseKey, analog)
				if err := checkPermissions(url); err != nil {
					rule.Analog.Status = StatusError
					rule.Analog.Message = err.Error()
				} else {
					rule.Analog.Status = StatusOK
				}
			}
		}

		editionsResult = append(editionsResult, rule)
	}

	return editionsResult, nil
}

//Create creates Resolver from:
// 1. URL in format: maxmind://<license_key>?editions=GeoIP2-City,GeoIP2-ASN (and others)
// 2. direct URL for download DB
// 3. file path to DB
// 4. dir path where there is a file (DB) with mmdbSuffix
func (f *MaxMindFactory) Create(path string) (Resolver, error) {
	//1,2
	if strings.Contains(path, MaxmindPrefix) {
		licenseKey, editions, err := f.parseMaxmindAddress(path)
		if err != nil {
			return nil, err
		}

		//use all paid editions by default
		if len(editions) == 0 {
			editions = []Edition{GeoIP2CountryEdition, GeoIP2CityEdition, GeoIP2ISPEdition, GeoIP2DomainEdition}
		}

		return f.createWithLicenseKey(licenseKey, editions)
	}

	//3
	if strings.Contains(path, "http://") || strings.Contains(path, "https://") {
		return f.createFromURL(path)
	}

	//4
	return f.createFromFile(path)
}

//parseMaxmindAddress parses maxmind://<license_key>?editions=edition1,edition2 format link
func (f *MaxMindFactory) parseMaxmindAddress(path string) (string, []Edition, error) {
	maxmindValue := strings.TrimPrefix(path, MaxmindPrefix)
	if !strings.Contains(maxmindValue, "?") {
		return maxmindValue, nil, nil
	}

	maxmindParts := strings.Split(maxmindValue, "?")
	if len(maxmindParts) != 2 {
		return "", nil, fmt.Errorf("malformed maxmind config [%s]. Should be in format - maxmind://<your license key>?editions=edition1,edition2", path)
	}

	licenseKey := maxmindParts[0]
	editionValues := strings.TrimPrefix(maxmindParts[1], "edition_id=")
	var editions []Edition
	for _, editionStr := range strings.Split(editionValues, ",") {
		edition, err := fromString(editionStr)
		if err != nil {
			return "", nil, err
		}
		editions = append(editions, edition)
	}

	return licenseKey, editions, nil
}

//createWithLicenseKey downloads maxmind db from the official maxmind URL
func (f *MaxMindFactory) createWithLicenseKey(licenseKey string, editions []Edition) (Resolver, error) {
	mmr := &MaxMindResolver{}
	for _, edition := range editions {
		parser, downloadedEdition, err := f.downloadOfficial(licenseKey, edition)
		if downloadedEdition == NotRequired {
			continue
		}
		if err != nil {
			if err == ErrInvalidLicenseKey {
				continue
			}

			return nil, err
		}

		mmr.setParser(parser, downloadedEdition)
	}

	return mmr, nil
}

//createFromURL downloads maxmind db from the url
func (f *MaxMindFactory) createFromURL(url string) (Resolver, error) {
	b, err := loadFromURL(url)
	if err != nil {
		return nil, err
	}

	parser, err := parseDBFromBytes(b)
	if err != nil {
		return nil, err
	}

	return newFromParser(parser)
}

//createFromFile finds maxmind db in dir/path and create Resolver
func (f *MaxMindFactory) createFromFile(path string) (Resolver, error) {
	if strings.HasSuffix(path, mmdbSuffix) {
		parser, err := geoip2.Open(path)
		if err != nil {
			return nil, err
		}

		return newFromParser(parser)
	}

	logging.Infof("start observing files in %s dir for .mmdb or .tar.gz files with maxmind db...", path)
	//find in dir or tar.gz archives
	b, err := findMmdbFile(path)
	if err != nil {
		return nil, err
	}

	parser, err := geoip2.FromBytes(b)
	if err != nil {
		return nil, err
	}

	return newFromParser(parser)
}

func findMmdbFile(dir string) ([]byte, error) {
	files, err := ioutil.ReadDir(dir)
	if err != nil {
		return nil, err
	}

	//find file with mmdbSuffix
	for _, f := range files {
		if strings.HasSuffix(f.Name(), mmdbSuffix) {
			return ioutil.ReadFile(path.Join(dir, f.Name()))
		}
	}

	//find inside tar.gz files
	for _, f := range files {
		if strings.HasSuffix(f.Name(), ".tar.gz") {
			absolutePath := path.Join(dir, f.Name())
			gzBytes, err := ioutil.ReadFile(absolutePath)
			if err != nil {
				return nil, fmt.Errorf("error reading archive %s: %v", absolutePath, err)
			}

			content, err := extractMaxMindDBFromTarGz(bytes.NewBuffer(gzBytes))
			if err != nil {
				if err == ErrMaxmindFileNotFound {
					continue
				}

				return nil, err
			}

			return content, nil
		}
	}

	return nil, ErrMaxmindFileNotFound
}

func (f *MaxMindFactory) downloadOfficial(licenseKey string, edition Edition) (*geoip2.Reader, Edition, error) {
	url := fmt.Sprintf(f.officialDownloadURLTemplate, licenseKey, edition)
	b, err := loadFromURL(url)
	if err != nil {
		//download analog
		if edition.FreeAnalog() != Unknown {
			edition = edition.FreeAnalog()
			if edition == NotRequired {
				return nil, NotRequired, nil
			}
			url = fmt.Sprintf(f.officialDownloadURLTemplate, licenseKey, edition)
			b, err = loadFromURL(url)
			if err != nil {
				return nil, "", err
			}
		} else {
			return nil, "", err
		}
	}

	reader, err := parseDBFromBytes(b)
	return reader, edition, err
}

//checkPermissions sends HTTP GET request and analyze HTTP response code
func checkPermissions(url string) error {
	r, err := http.Get(url)
	if err != nil {
		return fmt.Errorf("error loading db: %v", err)
	}
	defer r.Body.Close()

	if r.StatusCode != 200 {
		if r.StatusCode == http.StatusUnauthorized {
			return ErrInvalidLicenseKey
		}

		b, err := ioutil.ReadAll(r.Body)
		if err != nil {
			return fmt.Errorf("error reading db: %v", err)
		}
		return fmt.Errorf("error loading db: http code=%d [%s]", r.StatusCode, string(b))
	}

	return nil
}

func loadFromURL(url string) ([]byte, error) {
	logging.Infof("Start downloading maxmind from: %s", url)

	r, err := http.Get(url)
	if err != nil {
		return nil, fmt.Errorf("error loading db: %v", err)
	}
	defer r.Body.Close()

	b, err := ioutil.ReadAll(r.Body)
	if err != nil {
		return nil, fmt.Errorf("error reading db: %v", err)
	}

	if r.StatusCode != 200 {
		if r.StatusCode == http.StatusUnauthorized {
			return nil, ErrInvalidLicenseKey
		}

		return nil, fmt.Errorf("error loading db: http code=%d [%s]", r.StatusCode, string(b))
	}

	return b, err
}

func parseDBFromBytes(b []byte) (*geoip2.Reader, error) {
	reader, err := geoip2.FromBytes(b)
	if err != nil {
		//try to read tar.gz
		payloadFromTarGz, tarGzErr := extractMaxMindDBFromTarGz(bytes.NewBuffer(b))
		if tarGzErr != nil {
			return nil, err
		}

		return geoip2.FromBytes(payloadFromTarGz)
	}

	return reader, nil
}

//extractMaxMindDBFromTarGz extracts and decodes maxmind payload from reader
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

	return nil, ErrMaxmindFileNotFound
}
