package airbyte

import (
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/safego"
	"io"
	"os/exec"
	"strings"
	"sync"
)

var Instance *Bridge

type Bridge struct {
	LogWriter io.Writer

	mutex                 *sync.RWMutex
	specByDockerImage     map[string]interface{}
	specLoadingInProgress *sync.Map
	errorByDockerImage    map[string]error
}

func Init(logWriter io.Writer) {
	Instance = &Bridge{
		LogWriter:             logWriter,
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
		go b.loadSpec(dockerImage)
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

	outWriter := logging.NewStringWriter()
	errWriter := logging.NewStringWriter()
	if err := b.ExecCmd("docker", outWriter, errWriter, "run", "--rm", "-i", dockerImage, "spec"); err != nil {
		msg := "Error loading airbyte spec:"
		outStr := outWriter.String()
		errStr := errWriter.String()
		if outStr != "" {
			msg += "\n\t" + outStr
		}
		if errStr != "" {
			msg += "\n\t" + errStr
		}
		errMsg := fmt.Sprintf("%s\n\t%v", msg, err)
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

//ExecCmd executes command with args and uses stdOutWriter and stdErrWriter to pipe the result
func (b *Bridge) ExecCmd(cmd string, stdOutWriter, stdErrWriter io.Writer, args ...string) error {
	execCmd := exec.Command(cmd, args...)

	stdout, _ := execCmd.StdoutPipe()
	stderr, _ := execCmd.StderrPipe()

	err := execCmd.Start()
	if err != nil {
		return err
	}

	var wg sync.WaitGroup

	wg.Add(1)
	safego.Run(func() {
		defer wg.Done()
		io.Copy(stdOutWriter, stdout)
	})

	wg.Add(1)
	safego.Run(func() {
		defer wg.Done()
		io.Copy(stdErrWriter, stderr)
	})

	wg.Wait()

	err = execCmd.Wait()
	if err != nil {
		return err
	}

	return nil
}
