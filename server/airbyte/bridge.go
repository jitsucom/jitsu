package airbyte

import (
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/runner"
	"github.com/jitsucom/jitsu/server/safego"
	"io"
	"strings"
	"sync"
)

const (
	BridgeType                  = "airbyte_bridge"
	DockerImageRepositoryPrefix = "airbyte/"
)

var (
	Instance *Bridge
)

type Bridge struct {
	LogWriter       io.Writer
	ConfigDir       string
	WorkspaceVolume string

	mutex                 *sync.RWMutex
	specByDockerImage     map[string]interface{}
	specLoadingInProgress *sync.Map
	errorByDockerImage    map[string]error
}

//Init initializes airbyte Bridge
func Init(configDir, workspaceVolume string, logWriter io.Writer) {
	Instance = &Bridge{
		LogWriter:             logWriter,
		ConfigDir:             configDir,
		WorkspaceVolume:       workspaceVolume,
		mutex:                 &sync.RWMutex{},
		specByDockerImage:     map[string]interface{}{},
		specLoadingInProgress: &sync.Map{},
		errorByDockerImage:    map[string]error{},
	}
}

//GetOrLoadSpec returns spec JSON and nil if spec has been already loaded or
//starts loading spec and returns nil, nil or
//starts reloading and returns error if it occurred in previous loading
func (b *Bridge) GetOrLoadSpec(dockerImage string) (interface{}, error) {
	b.mutex.RLock()
	spec, ok := b.specByDockerImage[dockerImage]
	b.mutex.RUnlock()

	if ok {
		return spec, nil
	}

	if _, exists := b.specLoadingInProgress.LoadOrStore(dockerImage, true); !exists {
		safego.Run(func() {
			b.loadSpec(dockerImage)
		})
	}

	b.mutex.RLock()
	err, ok := b.errorByDockerImage[dockerImage]
	b.mutex.RUnlock()

	if ok {
		return nil, err
	}

	return nil, nil
}

func (b *Bridge) loadSpec(dockerImage string) {
	defer b.specLoadingInProgress.Delete(dockerImage)

	pullImgOutWriter := logging.NewStringWriter()
	pullImgErrWriter := logging.NewStringWriter()
	//pull last image
	if err := runner.ExecCmd(BridgeType, "docker", pullImgOutWriter, pullImgErrWriter, "pull", b.ReformatImageName(dockerImage)); err != nil {
		errMsg := b.BuildMsg("Error pulling airbyte image:", pullImgOutWriter, pullImgErrWriter, err)
		logging.Error(errMsg)

		b.mutex.Lock()
		b.errorByDockerImage[dockerImage] = errors.New(errMsg)
		b.mutex.Unlock()
		return
	}

	outWriter := logging.NewStringWriter()
	errWriter := logging.NewStringWriter()
	if err := runner.ExecCmd(BridgeType, "docker", outWriter, errWriter, "run", "--rm", "-i", b.ReformatImageName(dockerImage), "spec"); err != nil {
		errMsg := b.BuildMsg("Error loading airbyte spec:", outWriter, errWriter, err)
		logging.Error(errMsg)

		b.mutex.Lock()
		b.errorByDockerImage[dockerImage] = errors.New(errMsg)
		b.mutex.Unlock()
		return
	}

	parts := strings.Split(outWriter.String(), "\n")
	for _, p := range parts {
		v := map[string]interface{}{}
		if err := json.Unmarshal([]byte(p), &v); err == nil {
			b.mutex.Lock()
			b.specByDockerImage[dockerImage] = v
			delete(b.errorByDockerImage, dockerImage)
			b.mutex.Unlock()
			return
		}
	}

	errMsg := fmt.Sprintf("Error parsing airbyte spec as json: %s", outWriter.String())
	logging.Error(errMsg)

	b.mutex.Lock()
	b.errorByDockerImage[dockerImage] = errors.New(errMsg)
	b.mutex.Unlock()
	return
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
