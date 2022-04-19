package node

import (
	_ "embed"
	"encoding/json"
	"github.com/jitsucom/jitsu/server/runner"
	"io/ioutil"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"text/template"
	"time"

	"github.com/jitsucom/jitsu/server/timestamp"

	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/script"
	"github.com/jitsucom/jitsu/server/script/ipc"
	"github.com/pkg/errors"
	uuid "github.com/satori/go.uuid"
)

const (
	executableScriptName = "main.cjs"
	node                 = "node"
	npm                  = "npm"
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

type factory struct {
	packages map[string]string
}

func Factory() script.Factory {
	return &factory{
		packages: map[string]string{
			"node-fetch": "2.6.7",
			"vm2":        "3.9.9",
		},
	}
}

func (f *factory) CreateScript(executable script.Executable, variables map[string]interface{}, includes ...string) (script.Interface, error) {
	startTime := timestamp.Now()

	if _, err := exec.LookPath(node); err != nil {
		return nil, errors.Wrapf(err, "%s is not in $PATH. Please make sure that node and npm is installed and available in $PATH.", node)
	}

	if _, err := exec.LookPath(npm); err != nil {
		return nil, errors.Wrapf(err, "%s is not in $PATH. Please make sure that node and npm is installed and available in $PATH.", npm)
	}

	dir := filepath.Join(os.TempDir(), "jitsu-nodejs-"+uuid.NewV4().String())
	if err := os.RemoveAll(dir); err != nil {
		return nil, errors.Wrapf(err, "purge temp dir '%s'", dir)
	}

	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, errors.Wrapf(err, "create temp dir '%s'", dir)
	}

	if err := createPackageJSON(dir); err != nil {
		return nil, errors.Wrapf(err, "create package.json in '%s'", dir)
	}

	dependencies, err := getDependencies(executable)
	if err != nil {
		return nil, errors.Wrap(err, "get dependencies")
	}

	if err := f.installNodeModules(dir, dependencies); err != nil {
		return nil, errors.Wrapf(err, "install node modules in '%s'", dir)
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
		Path: node,
		Args: []string{"--max-old-space-size=100", executableScriptName},
	}

	governor, err := ipc.Govern(process)
	if err != nil {
		return nil, errors.Wrapf(err, "govern process")
	}

	logging.Debugf("%s running as %s/%s [took %s]", governor, dir, executableScriptName, timestamp.Now().Sub(startTime))
	return &Script{
		Governor: governor,
		Dir:      dir,
	}, nil
}

func escapeJSON(value interface{}) string {
	data, _ := json.Marshal(value)
	return strings.Trim(string(data), `"`)
}

func (f *factory) installNodeModules(dir string, modules []string) error {
	//ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	//defer cancel()

	args := []string{"install", "--prefer-offline", "--no-audit"}
	for name, version := range f.packages {
		if version != "" {
			args = append(args, name+"@"+version)
		} else {
			args = append(args, name)
		}
	}

	args = append(args, modules...)
	return runner.ExecCmd("node", dir, npm, logging.GlobalLogsWriter, logging.GlobalLogsWriter, time.Minute*2, args...)
}

func (f *factory) getExpression(dir string, executable script.Executable) (string, error) {
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
		packageJSON, err := readPackageJSON(dir)
		if err != nil {
			return "", errors.Wrap(err, "read runtime package.json")
		}

		dependencies := make([]string, 0)
		for dependency := range packageJSON.Dependencies {
			if _, ok := f.packages[dependency]; !ok {
				dependencies = append(dependencies, dependency)
			}
		}

		if len(dependencies) > 1 {
			return "", errors.Wrapf(err, "multiple external dependencies found: %v", dependencies)
		}

		packageName := dependencies[0]
		packageDir := filepath.Join(dir, "node_modules", packageName)
		packageJSON, err = readPackageJSON(packageDir)
		if err != nil {
			return "", errors.Wrap(err, "read package.json main field")
		}

		if packageJSON.Main == "" {
			return "", errors.Errorf("package.json main for %s is empty", packageName)
		}

		return readFile(filepath.Join(packageDir, packageJSON.Main))

	case script.File:
		return readFile(string(e))
	}

	return "", errors.Errorf("unrecognized executable %T", executable)
}

func readFile(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", errors.Wrapf(err, "open script file %s", path)
	}

	defer closeQuietly(file)
	data, err := ioutil.ReadAll(file)
	if err != nil {
		return "", errors.Wrapf(err, "read script file %s", path)
	}

	return string(data), nil
}

func getDependencies(executable script.Executable) ([]string, error) {
	switch e := executable.(type) {
	case script.Expression:
		return nil, nil
	case script.Package:
		return []string{string(e)}, nil
	case script.File:
		return nil, nil
	}

	return nil, errors.Errorf("unrecognized script executable %T", executable)
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

type packageJSON struct {
	Main         string            `json:"main"`
	Dependencies map[string]string `json:"dependencies"`
}

func readPackageJSON(dir string) (*packageJSON, error) {
	file, err := os.Open(packageJSONPath(dir))
	if err != nil {
		return nil, errors.Wrap(err, "open package.json")
	}

	defer closeQuietly(file)
	var data packageJSON
	if err := json.NewDecoder(file).Decode(&data); err != nil {
		return nil, errors.Wrap(err, "decode package.json")
	}

	return &data, nil
}

func createPackageJSON(dir string) error {
	file, err := os.Create(packageJSONPath(dir))
	if err != nil {
		return errors.Wrapf(err, "create package.json in '%s'", dir)
	}

	defer closeQuietly(file)
	if _, err := file.Write([]byte("{}")); err != nil {
		return errors.Wrapf(err, "write to package.json in '%s'", dir)
	}

	return nil
}

func packageJSONPath(dir string) string {
	return filepath.Join(dir, "package.json")
}
