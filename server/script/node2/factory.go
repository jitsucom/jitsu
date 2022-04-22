package node2

import (
	_ "embed"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"

	"github.com/mitchellh/hashstructure/v2"

	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/script"
	"github.com/jitsucom/jitsu/server/script/ipc"
	"github.com/pkg/errors"
)

const (
	node        = "node"
	npm         = "npm"
	nodePathEnv = "NODE_PATH"
)

var (
	//go:embed script.js
	scriptContent string
	dependencies  = map[string]string{
		"node-fetch": "2.6.7",
		"vm2":        "3.9.9",
	}
)

var errNodeRequired = errors.New(`node and/or npm is not found in $PATH.
	Jitsu will be functional, however JavaScript Functions won't be available. 
	Please make sure that node (>=16) and npm (>=8) are installed and available. 
	Or use @jitsucom/* docker images where all necessary packages are pre-installed`)

type Factory struct {
	dir     string
	plugins *sync.Map
	*exchanger
}

func NewFactory(tmpDir ...string) (*Factory, error) {
	if _, err := exec.LookPath(node); err != nil {
		return nil, errNodeRequired
	}

	if _, err := exec.LookPath(npm); err != nil {
		return nil, errNodeRequired
	}

	var dir string
	if len(tmpDir) > 0 {
		dir = tmpDir[0]
	} else {
		var err error
		dir, err = os.MkdirTemp(os.TempDir(), "jitsu-nodejs-")
		if err != nil {
			return nil, errors.Wrap(err, "failed to create temp directory")
		}
	}

	var nodePath string
	if nodePath = os.Getenv(nodePathEnv); nodePath != "" {
		for name, version := range dependencies {
			if err := checkNodeModule(nodePath, name, version); err != nil {
				logging.Warnf("failed to load preinstalled npm module from %s, falling back to install in tempdir %s: %v", nodePath, dir, err)
				nodePath = ""
				break
			}

			logging.Debugf("using preinstall npm module %s@%s", name, version)
		}
	}

	if nodePath == "" {
		for name, version := range dependencies {
			if version != "" {
				name += "@" + version
			}

			if err := installNodeModule(dir, name); err != nil {
				return nil, errors.Wrapf(err, "install package %s", name)
			}

			logging.Debugf("installed npm module %s in %s", name, dir)
		}
	}

	scriptName := "main.cjs"
	scriptPath := filepath.Join(dir, scriptName)
	scriptFile, err := os.Create(scriptPath)
	if err != nil {
		return nil, errors.Wrapf(err, "create %s", scriptPath)
	}

	_, err = scriptFile.WriteString(scriptContent)
	closeQuietly(scriptFile)
	if err != nil {
		return nil, errors.Wrapf(err, "write to %s", scriptPath)
	}

	process := &ipc.StdIO{
		Dir:  dir,
		Path: node,
		Args: []string{"--max-old-space-size=100", scriptPath},
		Env:  []string{nodePathEnv + "=" + nodePath},
	}

	governor, err := ipc.Govern(process)
	if err != nil {
		return nil, errors.Wrapf(err, "govern process")
	}

	logging.Debugf("%s running as %s/%s", governor, dir, scriptName)
	return &Factory{
		dir:       dir,
		plugins:   new(sync.Map),
		exchanger: &exchanger{Governor: governor},
	}, nil
}

func (f *Factory) Close() error {
	if err := f.Exchange(kill, nil, nil); err != nil {
		logging.Warnf("send kill signal failed, killing: %v", err)
		f.Governor.Kill()
	}

	if err := f.Governor.Wait(); err != nil {
		logging.Warnf("wait process failed: %v", err)
	}

	_ = os.RemoveAll(f.dir)
	return nil
}

func (f *Factory) CreateScript(executable script.Executable, variables map[string]interface{}, includes ...string) (script.Interface, error) {
	expression, err := f.getExpression(executable)
	if err != nil {
		return nil, errors.Wrapf(err, "get executable expression")
	}

	variables = sanitizeVariables(variables)

	init := &Init{
		Executable: expression,
		Variables:  variables,
		Includes:   includes,
	}

	hash, err := hashstructure.Hash(init, hashstructure.FormatV2, nil)
	if err != nil {
		return nil, errors.Wrap(err, "hash init")
	}

	init.Session.Session = fmt.Sprintf("%x", hash)
	return &Script{
		exchanger: f.exchanger,
		Init:      init,
	}, nil
}

func (f *Factory) getExpression(executable script.Executable) (string, error) {
	switch e := executable.(type) {
	case script.Expression:
		expression := string(e)
		if !strings.Contains(expression, "return") {
			expression = "return " + strings.Trim(expression, "\n")
		}

		return `
module.exports = async (event) => {
  let $ = event
  let _ = event
// expression start //
` + expression + `
// expression end //
}`, nil

	case script.Package:
		ref, _ := f.plugins.LoadOrStore(string(e), &pluginRef{plugin: string(e)})
		return ref.(*pluginRef).get()

	case script.File:
		data, err := os.ReadFile(string(e))
		if err != nil {
			return "", errors.Wrapf(err, "read file %s", string(e))
		}

		return string(data), nil
	}

	return "", errors.Errorf("unrecognized executable %T", executable)
}
