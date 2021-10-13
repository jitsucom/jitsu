package airbyte

import (
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/server/drivers/base"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/parsers"
	"github.com/jitsucom/jitsu/server/resources"
	"github.com/jitsucom/jitsu/server/runner"
	"github.com/jitsucom/jitsu/server/safego"
	"github.com/jitsucom/jitsu/server/uuid"
	"io"
	"os"
	"path"
	"strings"
	"sync"
)

const (
	BridgeType                  = "airbyte_bridge"
	DockerImageRepositoryPrefix = "airbyte/"

	VolumeAlias = "/tmp/airbyte/"
	Command     = "docker"
)

var (
	Instance *Bridge
)

type Bridge struct {
	LogWriter       io.Writer
	ConfigDir       string
	WorkspaceVolume string

	//spec loading
	specMutex             *sync.RWMutex
	specByDockerImage     map[string]interface{}
	specLoadingInProgress *sync.Map
	errorByDockerImage    map[string]error

	//catalog loading
	catalogMutex             *sync.RWMutex
	catalogByConfigHash      map[string]interface{}
	catalogLoadingInProgress *sync.Map
	errorByConfigHash        map[string]error
}

//Init initializes airbyte Bridge
func Init(configDir, workspaceVolume string, logWriter io.Writer) {
	Instance = &Bridge{
		LogWriter:       logWriter,
		ConfigDir:       configDir,
		WorkspaceVolume: workspaceVolume,

		specMutex:             &sync.RWMutex{},
		specByDockerImage:     map[string]interface{}{},
		specLoadingInProgress: &sync.Map{},
		errorByDockerImage:    map[string]error{},

		catalogMutex:             &sync.RWMutex{},
		catalogByConfigHash:      map[string]interface{}{},
		catalogLoadingInProgress: &sync.Map{},
		errorByConfigHash:        map[string]error{},
	}
}

//GetOrLoadSpec returns spec JSON and nil if spec has been already loaded or
//starts loading spec and returns nil, nil or
//starts reloading and returns error if it occurred in previous loading
func (b *Bridge) GetOrLoadSpec(dockerImage string) (interface{}, error) {
	b.specMutex.RLock()
	spec, ok := b.specByDockerImage[dockerImage]
	b.specMutex.RUnlock()

	if ok {
		return spec, nil
	}

	if _, exists := b.specLoadingInProgress.LoadOrStore(dockerImage, true); !exists {
		safego.Run(func() {
			b.loadSpec(dockerImage)
		})
	}

	b.specMutex.RLock()
	err, ok := b.errorByDockerImage[dockerImage]
	b.specMutex.RUnlock()

	if ok {
		return nil, err
	}

	return nil, nil
}

//GetOrLoadCatalog returns catalog JSON and nil if catalog has been already loaded or
//starts loading catalog and returns nil, nil or
//starts reloading and returns error if it occurred in previous loading
func (b *Bridge) GetOrLoadCatalog(dockerImage string, config map[string]interface{}) (interface{}, error) {
	configHash, err := resources.GetHash(config)
	if err != nil {
		return nil, err
	}

	key := fmt.Sprintf("%s-%d", dockerImage, configHash)

	b.catalogMutex.RLock()
	catalog, ok := b.catalogByConfigHash[key]
	b.catalogMutex.RUnlock()

	if ok {
		return catalog, nil
	}

	if _, exists := b.catalogLoadingInProgress.LoadOrStore(key, true); !exists {
		safego.Run(func() {
			b.loadCatalog(key, dockerImage, config)
		})
	}

	b.catalogMutex.RLock()
	err, ok = b.errorByConfigHash[key]
	b.catalogMutex.RUnlock()

	if ok {
		return nil, err
	}

	return nil, nil
}

//loadCatalog discovers catalog
//returns catalog bytes or error if occurred
func (b *Bridge) loadCatalog(key, dockerImage string, config map[string]interface{}) {
	defer b.catalogLoadingInProgress.Delete(key)

	//discover catalog
	catalogRow, err := b.executeDiscover(dockerImage, config)
	if err != nil {
		logging.Error(err)

		b.catalogMutex.Lock()
		b.errorByConfigHash[key] = err
		b.catalogMutex.Unlock()
		return
	}

	b.catalogMutex.Lock()
	b.catalogByConfigHash[key] = catalogRow
	delete(b.errorByConfigHash, key)
	b.catalogMutex.Unlock()
}

func (b *Bridge) executeDiscover(dockerImage string, config map[string]interface{}) (*CatalogRow, error) {
	outWriter := logging.NewStringWriter()
	errStrWriter := logging.NewStringWriter()
	dualStdErrWriter := logging.Dual{FileWriter: errStrWriter, Stdout: logging.NewPrefixDateTimeProxy("[discover]", b.LogWriter)}

	generatedDir := uuid.NewLettersNumbers()
	generatedConfigFilePath := path.Join(b.ConfigDir, generatedDir)
	if err := logging.EnsureDir(generatedConfigFilePath); err != nil {
		return nil, fmt.Errorf("Error creating airbyte generated config dir: %v", err)
	}
	defer func() {
		if err := os.RemoveAll(generatedConfigFilePath); err != nil {
			logging.SystemErrorf("Error deleting generated airbyte config dir [%s]: %v", generatedConfigFilePath, err)
		}
	}()

	generatedConfigFileName := uuid.NewLettersNumbers() + ".json"
	//write airbyte config as file path
	_, err := parsers.ParseJSONAsFile(path.Join(generatedConfigFilePath, generatedConfigFileName), config)
	if err != nil {
		return nil, fmt.Errorf("Error writing airbyte config [%v]: %v", config, err)
	}

	args := []string{"run", "--rm", "-i", "-v", fmt.Sprintf("%s:%s", b.WorkspaceVolume, VolumeAlias), b.ReformatImageName(dockerImage), "discover", "--config", path.Join(VolumeAlias, generatedDir, generatedConfigFileName)}

	err = runner.ExecCmd(base.AirbyteType, Command, outWriter, dualStdErrWriter, args...)
	if err != nil {
		msg := b.BuildMsg("Error airbyte --discover:", outWriter, errStrWriter, err)
		return nil, errors.New(msg)
	}

	catalogRow, err := b.ParseCatalogRow(outWriter)
	if err != nil {
		return nil, err
	}

	return catalogRow.Catalog, nil
}

func (b *Bridge) loadSpec(dockerImage string) {
	defer b.specLoadingInProgress.Delete(dockerImage)

	outWriter := logging.NewStringWriter()
	errWriter := logging.NewStringWriter()
	if err := runner.ExecCmd(BridgeType, Command, outWriter, errWriter, "run", "--rm", "-i", b.ReformatImageName(dockerImage), "spec"); err != nil {
		errMsg := b.BuildMsg("Error loading airbyte spec:", outWriter, errWriter, err)
		logging.Error(errMsg)

		b.specMutex.Lock()
		b.errorByDockerImage[dockerImage] = errors.New(errMsg)
		b.specMutex.Unlock()
		return
	}

	spec, err := b.parseSpecRow(outWriter)
	if err != nil {
		logging.Error(err)

		b.specMutex.Lock()
		b.errorByDockerImage[dockerImage] = err
		b.specMutex.Unlock()
		return
	}

	b.specMutex.Lock()
	b.specByDockerImage[dockerImage] = spec
	delete(b.errorByDockerImage, dockerImage)
	b.specMutex.Unlock()
}

//parseSpecRow parses output, finds catalog row and returns it or returns err
func (b *Bridge) parseSpecRow(outWriter *logging.StringWriter) (*Row, error) {
	parts := strings.Split(outWriter.String(), "\n")
	for _, p := range parts {
		parsedRow := &Row{}
		err := json.Unmarshal([]byte(p), parsedRow)
		if err != nil {
			continue
		}

		if parsedRow.Type != SpecType || parsedRow.Spec == nil {
			continue
		}

		return parsedRow, nil
	}

	return nil, fmt.Errorf("Error parsing airbyte spec result as json: %s", outWriter.String())
}

//ParseCatalogRow parses output, finds catalog row and returns it or returns err
func (b *Bridge) ParseCatalogRow(outWriter *logging.StringWriter) (*Row, error) {
	parts := strings.Split(outWriter.String(), "\n")
	for _, p := range parts {
		parsedRow := &Row{}
		err := json.Unmarshal([]byte(p), parsedRow)
		if err != nil {
			continue
		}

		if parsedRow.Type != CatalogType || parsedRow.Catalog == nil {
			continue
		}

		return parsedRow, nil
	}

	return nil, fmt.Errorf("Error parsing airbyte discover result as json: %s", outWriter.String())
}

//BuildMsg returns formatted error
func (b *Bridge) BuildMsg(prefix string, outWriter, errWriter *logging.StringWriter, err error) string {
	msg := prefix
	outStr := outWriter.String()
	errStr := errWriter.String()
	if outStr != "" {
		if msg != "" {
			msg += "\n\t"
		}
		msg += outStr
	}
	if errStr != "" {
		if msg != "" {
			msg += "\n\t"
		}
		msg += errStr
	}
	return fmt.Sprintf("%s\n\t%v", msg, err)
}

//ReformatImageName adds airbyte/ prefix to dockerImage if doesn't exist
func (b *Bridge) ReformatImageName(dockerImage string) string {
	if !strings.HasPrefix(dockerImage, DockerImageRepositoryPrefix) {
		return DockerImageRepositoryPrefix + dockerImage
	}

	return dockerImage
}
