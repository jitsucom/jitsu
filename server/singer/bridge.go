package singer

import (
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/runner"
	"github.com/jitsucom/jitsu/server/safego"
	"io"
	"io/ioutil"
	"path"
	"strings"
	"sync"
)

const singerBridgeType = "singer_bridge"

var Instance *Bridge

type Bridge struct {
	mutex          *sync.RWMutex
	PythonExecPath string
	VenvDir        string
	installTaps    bool
	updateTaps     bool
	LogWriter      io.Writer

	installedTaps         *sync.Map
	installInProgressTaps *sync.Map
	installErrorsByTap    map[string]error
}

func Init(pythonExecPath, venvDir string, installTaps, updateTaps bool, logWriter io.Writer) error {
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

	b.mutex.RLock()
	err, ok := b.installErrorsByTap[tap]
	b.mutex.RUnlock()

	if ok {
		return false, err
	}

	return false, nil
}

//EnsureTap runs async update pip and install singer tap
func (b *Bridge) EnsureTap(tap string) {
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
	err := runner.ExecCmd(singerBridgeType, b.PythonExecPath, b.LogWriter, b.LogWriter, "-m", "venv", pathToTap)
	if err != nil {
		return fmt.Errorf("error creating singer python venv for [%s]: %v", pathToTap, err)
	}

	//update pip
	err = runner.ExecCmd(singerBridgeType, path.Join(pathToTap, "/bin/python3"), b.LogWriter, b.LogWriter, "-m", "pip", "install", "--upgrade", "pip")
	if err != nil {
		return fmt.Errorf("error updating pip for [%s] env: %v", pathToTap, err)

	}

	//install tap
	err = runner.ExecCmd(singerBridgeType, path.Join(pathToTap, "/bin/pip3"), b.LogWriter, b.LogWriter, "install", tap)
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

	err := runner.ExecCmd(singerBridgeType, command, b.LogWriter, b.LogWriter, args...)
	if err != nil {
		return err
	}

	return nil
}
