package node

import (
	_ "embed"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"text/template"

	"github.com/jitsucom/jitsu/server/timestamp"
	uuid "github.com/satori/go.uuid"

	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/script"
	"github.com/jitsucom/jitsu/server/script/ipc"
	"github.com/pkg/errors"
)

const (
	node = "node"
	npm  = "npm"
)

type scriptTemplateValues struct {
	Executable string
	Variables  string
	Includes   string
	LineOffset int
	ColOffset  int
}

var (
	//go:embed script.js
	scriptTemplateContent string
	scriptTemplate, _     = template.New("node_script").Parse(scriptTemplateContent)

	dependencies = map[string]string{
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

	if err := createPackageJSON(dir, packageJSON{}); err != nil {
		return nil, errors.Wrapf(err, "create package.json in %s", dir)
	}

	for name, version := range dependencies {
		if version != "" {
			name += "@" + version
		}

		if err := installNodeModule(dir, name); err != nil {
			return nil, errors.Wrapf(err, "install package %s", name)
		}
	}

	return &Factory{
		dir:     dir,
		plugins: new(sync.Map),
	}, nil
}

func (f *Factory) Close() error {
	return os.RemoveAll(f.dir)
}

func (f *Factory) CreateScript(executable script.Executable, variables map[string]interface{}, includes ...string) (script.Interface, error) {
	startTime := timestamp.Now()
	scriptName := uuid.NewV4().String() + ".cjs"
	scriptPath := filepath.Join(f.dir, scriptName)
	scriptFile, err := os.Create(scriptPath)
	if err != nil {
		return nil, errors.Wrapf(err, "create main script in '%s'", f.dir)
	}

	expression, err := f.getExpression(f.dir, executable)
	if err != nil {
		return nil, errors.Wrapf(err, "get executable expression")
	}

	variables = sanitizeVariables(variables)
	variablesJSON, err := json.Marshal(variables)
	if err != nil {
		return nil, errors.Wrap(err, "marshal variables json")
	}

	err = scriptTemplate.Execute(scriptFile, scriptTemplateValues{
		Executable: escapeJSON(expression),
		Includes:   escapeJSON(strings.Join(includes, "\n")),
		Variables:  escapeJSON(string(variablesJSON)),
		LineOffset: getLineOffset(executable),
		ColOffset:  getColOffset(executable),
	})

	closeQuietly(scriptFile)
	if err != nil {
		return nil, errors.Wrapf(err, "execute script template to '%s'", scriptPath)
	}

	process := &ipc.StdIO{
		Dir:  f.dir,
		Path: node,
		Args: []string{"--max-old-space-size=100", scriptPath},
	}

	governor, err := ipc.Govern(process)
	if err != nil {
		return nil, errors.Wrapf(err, "govern process")
	}

	logging.Debugf("%s running as %s/%s [took %s]", governor, f.dir, scriptName, timestamp.Now().Sub(startTime))
	return &Script{
		Governor: governor,
		File:     scriptPath,
	}, nil
}

func getColOffset(executable script.Executable) int {
	if e, ok := executable.(script.Expression); ok {
		if !strings.Contains(string(e), "return") {
			return 7
		}
	}

	return 0
}

func getLineOffset(executable script.Executable) int {
	switch executable.(type) {
	case script.Expression:
		return 5
	default:
		return 0
	}
}

func (f *Factory) getExpression(dir string, executable script.Executable) (string, error) {
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
