package templates

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"text/template"
	"time"

	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/templates/ipc"
	"github.com/jitsucom/jitsu/server/timestamp"
	"github.com/pkg/errors"
	uuid "github.com/satori/go.uuid"
)

type nodeCommand string

const (
	nodeTransformCommand nodeCommand = "transform"
	nodeKillCommand      nodeCommand = "kill"
)

const nodeScriptName = "main.js"

type nodeScriptTemplateValues struct {
	Expression string
	Execute    string
}

var (
	//go:embed node_template.js
	nodeStdIOScriptRawTemplate string
	//go:embed node_stdio_execute.js
	NodeStdIOExecuteScript string
	//go:embed node_sysv_execute.js
	NodeSysVExecuteScript      string
	nodeStdIOScriptTemplate, _ = template.New("node_ipc").Parse(nodeStdIOScriptRawTemplate)
)

type nodeRequest struct {
	Command nodeCommand `json:"command"`
	Payload interface{} `json:"payload,omitempty"`
}

type nodeResponse struct {
	Ok     bool            `json:"ok"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  string          `json:"error,omitempty"`
}

type NodeExecutor struct {
	expression string
	governor   *ipc.Governor
	dir        string
}

type NodeTransport struct {
	AdditionalArgs []string
	Execute        string
	Packages       []string
	Factory        ProcessFactory
}

var NodeStdIO = &NodeTransport{
	Execute: NodeStdIOExecuteScript,
	Factory: func(dir, path, script string) ipc.Process {
		return &ipc.StdIO{
			Dir:  dir,
			Path: path,
			Args: []string{script},
		}
	},
}

var NodeSysV = &NodeTransport{
	Execute:  NodeSysVExecuteScript,
	Packages: []string{"svmq"},
	Factory: func(dir, path, script string) ipc.Process {
		return &ipc.SysV{
			Dir:  dir,
			Path: path,
			Args: []string{script},
		}
	},
}

type ProcessFactory func(dir, path, script string) ipc.Process

func NewNodeExecutor(transport *NodeTransport, expression string, packages ...string) (*NodeExecutor, error) {
	dir := filepath.Join(os.TempDir(), "jitsu-node-"+uuid.NewV4().String())
	if err := os.RemoveAll(dir); err != nil {
		return nil, errors.Wrapf(err, "purge temp dir '%s'", dir)
	}

	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, errors.Wrapf(err, "create temp dir '%s'", dir)
	}

	scriptPath := filepath.Join(dir, nodeScriptName)
	script, err := os.Create(scriptPath)
	if err != nil {
		return nil, errors.Wrapf(err, "create temp script in '%s'", dir)
	}

	var compiledExpression bytes.Buffer
	if err := nodeStdIOScriptTemplate.Execute(&compiledExpression, nodeScriptTemplateValues{
		Expression: expression,
		Execute:    transport.Execute,
	}); err != nil {
		return nil, errors.Wrap(err, "failed to compile node ipc template")
	}

	if _, err := script.WriteString(compiledExpression.String()); err != nil {
		return nil, errors.Wrapf(err, "failed to write temp script in '%s'", dir)
	}

	packages = append(packages, "node-fetch@2")
	packages = append(packages, transport.Packages...)
	if err := installNodeModules(dir, packages...); err != nil {
		return nil, errors.Wrap(err, "install node modules")
	}

	process := transport.Factory(dir, "node", nodeScriptName)
	governor, err := ipc.Govern(process)
	if err != nil {
		return nil, errors.Wrap(err, "create node process")
	}

	logging.Debugf("%s running in %s with script:\n\n%s\n", governor, dir, compiledExpression.String())
	return &NodeExecutor{
		expression: expression,
		governor:   governor,
		dir:        dir,
	}, nil
}

func installNodeModules(dir string, packages ...string) error {
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	npmArgs := []string{"install"}
	npmArgs = append(npmArgs, packages...)
	cmd := exec.CommandContext(ctx, "npm", npmArgs...)
	cmd.Dir = dir
	return cmd.Run()
}

func (e *NodeExecutor) ProcessEvent(event events.Event) (interface{}, error) {
	var value interface{}
	return value, e.exchange(nodeTransformCommand, event, &value)
}

func (e *NodeExecutor) exchange(command nodeCommand, payload, result interface{}) error {
	data, err := json.Marshal(nodeRequest{
		Command: command,
		Payload: payload,
	})

	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()

	start := timestamp.Now()
	newData, err := e.governor.Exchange(ctx, data)
	logging.Debugf("%s: %s => %s (%v) [%s]", e.governor, string(data), string(newData), err, timestamp.Now().Sub(start))
	if err != nil {
		return err
	}

	var resp nodeResponse
	if err := json.Unmarshal(newData, &resp); err != nil {
		return err
	}

	if !resp.Ok {
		if strings.HasPrefix(resp.Error, "__retry: ") {
			logging.Warnf("%s retrying request %s due to %s", e.governor, string(data), resp.Error[len("__retry: "):])
			return e.exchange(command, payload, result)
		}

		return errors.New(resp.Error)
	}

	if result != nil {
		return json.Unmarshal(resp.Result, result)
	}

	return nil
}

func (e *NodeExecutor) Format() string {
	return "javascript"
}

func (e *NodeExecutor) Expression() string {
	return e.expression
}

func (e *NodeExecutor) Close() {
	if err := e.exchange(nodeKillCommand, nil, nil); err != nil {
		logging.Warnf("send kill signal failed, killing: %v", err)
		e.governor.Kill()
	}

	if err := e.governor.Wait(); err != nil {
		logging.Warnf("wait process failed: %v", err)
	}

	_ = os.RemoveAll(e.dir)
}
