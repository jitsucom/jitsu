package singer

import (
	"errors"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/safego"
	"io"
	"io/ioutil"
	"os/exec"
	"path"
	"strings"
	"sync"
)

var Instance *Bridge

type Bridge struct {
	PythonExecPath string
	VenvDir        string
	installTaps    bool
	LogWriter      io.Writer

	installedTaps         *sync.Map
	installInProgressTaps *sync.Map
}

func Init(pythonExecPath, venvDir string, installTaps bool, logWriter io.Writer) error {
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
		PythonExecPath:        pythonExecPath,
		VenvDir:               venvDir,
		installTaps:           installTaps,
		LogWriter:             logWriter,
		installedTaps:         installedTaps,
		installInProgressTaps: &sync.Map{},
	}

	return nil
}

//IsTapReady returns true if the tap is ready for using
func (b *Bridge) IsTapReady(tap string) bool {
	_, ready := b.installedTaps.Load(tap)
	return ready
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

			pathToTap := path.Join(b.VenvDir, tap)

			//create virtual env
			err := b.ExecCmd(b.PythonExecPath, b.LogWriter, b.LogWriter, "-m", "venv", pathToTap)
			if err != nil {
				logging.Errorf("Error creating singer python venv for [%s]: %v", pathToTap, err)
				return
			}

			//update pip
			err = b.ExecCmd(path.Join(pathToTap, "/bin/python3"), b.LogWriter, b.LogWriter, "-m", "pip", "install", "--upgrade", "pip")
			if err != nil {
				logging.Errorf("Error updating pip for [%s] env: %v", pathToTap, err)
				return
			}

			//install tap
			err = b.ExecCmd(path.Join(pathToTap, "/bin/pip3"), b.LogWriter, b.LogWriter, "install", tap)
			if err != nil {
				logging.Errorf("Error installing singer tap [%s]: %v", tap, err)
				return
			}

			b.installedTaps.Store(tap, 1)
		})
	} else {
		b.installedTaps.Store(tap, 1)
	}
}

//ExecCmd executes command with args and uses stdOutWriter and stdErrWriter to pipe the result
func (b *Bridge) ExecCmd(cmd string, stdOutWriter, stdErrWriter io.Writer, args ...string) error {
	logging.Debugf("Running Singer command: %s with args [%s]", cmd, strings.Join(args, ", "))
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
