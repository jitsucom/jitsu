package singer

import (
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/server/drivers/base"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/parsers"
	"github.com/jitsucom/jitsu/server/runner"
	"github.com/jitsucom/jitsu/server/safego"
	"io"
	"io/ioutil"
	"path"
	"strings"
	"sync"
	"time"
)

const singerBridgeType = "singer_bridge"

var Instance *Bridge

type Bridge struct {
	mutex          *sync.RWMutex
	PythonExecPath string
	VenvDir        string
	TmpDir         string
	BatchSize      int

	installTaps bool
	updateTaps  bool

	LogWriter io.Writer

	installedTaps         *sync.Map
	installInProgressTaps *sync.Map
	installErrorsByTap    map[string]error
}

func Init(pythonExecPath, venvDir string, installTaps, updateTaps bool, batchSize int, logWriter io.Writer) error {
	logging.Infof("Initializing Singer bridge. Batch size: %d", batchSize)

	if pythonExecPath == "" {
		return errors.New("Singer bridge python exec path can't be empty")
	}

	if pythonExecPath == "" {
		return errors.New("Singer bridge venv dir can't be empty")
	}

	if logWriter == nil {
		logWriter = ioutil.Discard
	}

	installedTaps := &sync.Map{}

	//load already installed taps
	files, err := ioutil.ReadDir(venvDir)
	if err == nil {
		for _, f := range files {
			if f.IsDir() && strings.HasPrefix(f.Name(), "tap-") {
				installedTaps.Store(strings.TrimSpace(f.Name()), 1)
			}
		}
	}

	Instance = &Bridge{
		mutex:                 &sync.RWMutex{},
		PythonExecPath:        pythonExecPath,
		VenvDir:               venvDir,
		TmpDir:                path.Join(venvDir, "tmp"),
		BatchSize:             batchSize,
		installTaps:           installTaps,
		LogWriter:             logWriter,
		installedTaps:         installedTaps,
		updateTaps:            updateTaps,
		installInProgressTaps: &sync.Map{},
		installErrorsByTap:    map[string]error{},
	}

	return nil
}

//IsTapReady returns true if the tap is ready for using
func (b *Bridge) IsTapReady(tap string) (bool, error) {
	_, ready := b.installedTaps.Load(tap)
	if ready {
		return true, nil
	}

	b.ensureTap(tap)

	b.mutex.RLock()
	err, ok := b.installErrorsByTap[tap]
	b.mutex.RUnlock()

	if ok {
		return false, err
	}

	return false, nil
}

//ensureTap runs async update pip and install singer tap
func (b *Bridge) ensureTap(tap string) {
	//ensure tap is installed
	if b.installTaps {
		//tap is installed
		_, isInstalled := b.installedTaps.Load(tap)
		if isInstalled {
			return
		}

		//tap is being installed
		_, isBeingInstalled := b.installInProgressTaps.LoadOrStore(tap, 1)
		if isBeingInstalled {
			return
		}

		safego.Run(func() {
			defer b.installInProgressTaps.Delete(tap)

			err := b.installTap(tap)
			if err != nil {
				logging.Error(err)
				b.mutex.Lock()
				b.installErrorsByTap[tap] = err
				b.mutex.Unlock()
				return
			}

			b.mutex.Lock()
			delete(b.installErrorsByTap, tap)
			b.mutex.Unlock()
			b.installedTaps.Store(tap, 1)
		})
	} else {
		b.installedTaps.Store(tap, 1)
	}
}

//installTap runs pip install tap
func (b *Bridge) installTap(tap string) error {
	pathToTap := path.Join(b.VenvDir, tap)

	//create virtual env
	err := runner.ExecCmd(singerBridgeType, "", b.PythonExecPath, b.LogWriter, b.LogWriter, time.Minute*10, "-m", "venv", pathToTap)
	if err != nil {
		return fmt.Errorf("error creating singer python venv for [%s]: %v", pathToTap, err)
	}

	//update pip
	err = runner.ExecCmd(singerBridgeType, "", path.Join(pathToTap, "/bin/python3"), b.LogWriter, b.LogWriter, time.Minute*10, "-m", "pip", "install", "--upgrade", "pip")
	if err != nil {
		return fmt.Errorf("error updating pip for [%s] env: %v", pathToTap, err)

	}

	//install tap
	err = runner.ExecCmd(singerBridgeType, "", path.Join(pathToTap, "/bin/pip3"), b.LogWriter, b.LogWriter, time.Minute*20, "install", tap)
	if err != nil {
		return fmt.Errorf("error installing singer tap [%s]: %v", tap, err)
	}

	return nil
}

//UpdateTap runs sync update singer tap and returns err if occurred
func (b *Bridge) UpdateTap(tap string) error {
	if !b.updateTaps {
		return nil
	}

	pathToTap := path.Join(b.VenvDir, tap)
	command := path.Join(pathToTap, "/bin/pip3")
	args := []string{"install", tap, "--upgrade"}

	err := runner.ExecCmd(singerBridgeType, "", command, b.LogWriter, b.LogWriter, time.Minute*20, args...)
	if err != nil {
		return err
	}

	return nil
}

//Discover discovers tap catalog, marks all streams as "enabled" and returns catalog
func (b *Bridge) Discover(tap, singerConfigPath string) (*RawCatalog, error) {
	outWriter := logging.NewStringWriter()
	errStrWriter := logging.NewStringWriter()
	dualStdErrWriter := logging.Dual{FileWriter: errStrWriter, Stdout: logging.NewPrefixDateTimeProxy("[discover]", b.LogWriter)}

	command := path.Join(b.VenvDir, tap, "bin", tap)
	args := []string{"-c", singerConfigPath, "--discover"}

	if err := runner.ExecCmd(base.SingerType, "", command, outWriter, dualStdErrWriter, time.Minute*2, args...); err != nil {
		return nil, fmt.Errorf("Error singer --discover: %v. %s", err, errStrWriter.String())
	}

	catalog := &RawCatalog{}
	if err := json.Unmarshal(outWriter.Bytes(), &catalog); err != nil {
		return nil, fmt.Errorf("Error unmarshalling catalog %s output: %v", outWriter.String(), err)
	}

	for _, stream := range catalog.Streams {
		//put selected=true into 'schema'
		schemaStruct, ok := stream["schema"]
		if !ok {
			return nil, fmt.Errorf("Malformed discovered catalog structure %s: key 'schema' doesn't exist", outWriter.String())
		}
		schemaObj, ok := schemaStruct.(map[string]interface{})
		if !ok {
			return nil, fmt.Errorf("Malformed discovered catalog structure %s: value under key 'schema' must be object: %T", outWriter.String(), schemaStruct)
		}

		schemaObj["selected"] = true

		//put selected=true into every 'metadata' object
		metadataArrayIface, ok := stream["metadata"]
		if ok {
			metadataArray, ok := metadataArrayIface.([]interface{})
			if ok {
				for _, metadata := range metadataArray {
					metadataObj, ok := metadata.(map[string]interface{})
					if ok {
						innerMetadata, ok := metadataObj["metadata"]
						if ok {
							innerMetadataObj, ok := innerMetadata.(map[string]interface{})
							if ok {
								innerMetadataObj["selected"] = true
							}
						}
					}
				}
			}
		}
	}

	return catalog, nil
}

//SaveConfig saves config as file for using
//returns absolute file path to generated file
func SaveConfig(sourceId string, tap string, singerConfig interface{}) (string, error) {
	configDir := path.Join(Instance.VenvDir, sourceId, tap)

	if err := logging.EnsureDir(configDir); err != nil {
		return "", fmt.Errorf("Error creating singer tmp dir: %v", err)
	}

	absoluteFilePath := path.Join(configDir, base.ConfigFileName)
	//write singer config as file path
	if _, err := parsers.ParseJSONAsFile(absoluteFilePath, singerConfig); err != nil {
		return "", fmt.Errorf("Error writing singer to %s: %v", absoluteFilePath, err)
	}

	return absoluteFilePath, nil
}
