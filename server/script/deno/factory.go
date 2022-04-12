package deno

import (
	_ "embed"
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"text/template"

	"github.com/jitsucom/jitsu/server/script/node"

	"github.com/jitsucom/jitsu/server/timestamp"

	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/script"
	"github.com/jitsucom/jitsu/server/script/ipc"
	"github.com/pkg/errors"
	uuid "github.com/satori/go.uuid"
)

const (
	executableScriptName = "main.cjs"
	deno                 = "deno"
)

type scriptTemplateValues struct {
	Executable string
	Variables  string
	Includes   string
}

var (
	//go:embed script.js
	scriptTemplateContent string
	scriptTemplate, _     = template.New("node_script").Parse(scriptTemplateContent)
)

type factory struct{}

func Factory() script.Factory {
	return &factory{}
}

func (f *factory) CreateScript(executable script.Executable, variables map[string]interface{}, includes ...string) (script.Interface, error) {
	startTime := timestamp.Now()

	if _, err := exec.LookPath(deno); err != nil {
		return nil, errors.Wrapf(err, "%s is not in $PATH. Please make sure that deno is installed and available in $PATH.", deno)
	}

	dir := filepath.Join(os.TempDir(), "jitsu-deno-"+uuid.NewV4().String())
	if err := os.RemoveAll(dir); err != nil {
		return nil, errors.Wrapf(err, "purge temp dir '%s'", dir)
	}

	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, errors.Wrapf(err, "create temp dir '%s'", dir)
	}

	scriptPath := filepath.Join(dir, executableScriptName)
	scriptFile, err := os.Create(scriptPath)
	if err != nil {
		return nil, errors.Wrapf(err, "create main script in '%s'", dir)
	}

	expression, err := f.getExpression(dir, executable)
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
		Variables:  string(variablesJSON),
	})

	closeQuietly(scriptFile)
	if err != nil {
		return nil, errors.Wrapf(err, "execute script template to '%s'", scriptPath)
	}

	process := &ipc.StdIO{
		Dir:  dir,
		Path: deno,
		Args: []string{"run", executableScriptName},
	}

	governor, err := ipc.Govern(process)
	if err != nil {
		return nil, errors.Wrapf(err, "govern process")
	}

	logging.Debugf("%s running as %s/%s [took %s]", governor, dir, executableScriptName, timestamp.Now().Sub(startTime))
	return &node.Script{
		Governor: governor,
		Dir:      dir,
	}, nil
}

func escapeJSON(value interface{}) string {
	data, _ := json.Marshal(value)
	return strings.Trim(string(data), `"`)
}

func (f *factory) getExpression(dir string, executable script.Executable) (string, error) {
	switch e := executable.(type) {
	case script.Expression:
		expression := string(e)
		if !strings.Contains(expression, "return") {
			expression = "return " + strings.Trim(expression, "\n")
		}

		return `
async (event) => {
  let $ = event
  let _ = event
// expression start //
` + expression + `
// expression end //
}`, nil
	}

	return "", errors.Errorf("unrecognized executable %T", executable)
}

func sanitizeVariables(vars map[string]interface{}) map[string]interface{} {
	variables := make(map[string]interface{})
	for key, value := range vars {
		if reflect.TypeOf(value).Kind() != reflect.Func {
			variables[key] = value
		}
	}

	return variables
}

func closeQuietly(close io.Closer) {
	if err := close.Close(); err != nil {
		logging.Warnf("failed to close %T: %v", close, err)
	}
}
