package singer

import (
	"errors"
	"io"
	"io/ioutil"
)

var Instance *Bridge

type Bridge struct {
	PythonExecPath string
	VenvDir        string
	InstallTaps    bool
	LogWriter      io.Writer
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

	Instance = &Bridge{
		PythonExecPath: pythonExecPath,
		VenvDir:        venvDir,
		InstallTaps:    installTaps,
		LogWriter:      logWriter,
	}

	return nil
}
