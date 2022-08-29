package node

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"github.com/jitsucom/jitsu/server/templates"
	"github.com/jitsucom/jitsu/server/utils"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/jitsucom/jitsu/server/events"
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
	mainFile    = "main.cjs"

	JitsuKvGetCommand = "_JITSU_KV_GET"
	JitsuKvSetCommand = "_JITSU_KV_SET"
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
	maxSpace         int
	dir              string
	nodePath         string
	plugins          *sync.Map
	exchangers       []*exchanger
	mu               ipc.Mutex
	transformStorage templates.Storage
}

func NewFactory(poolSize, maxSpace int, transformStorage templates.Storage, tmpDir ...string) (*Factory, error) {
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

			logging.Debugf("using preinstalled npm module %s@%s", name, version)
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

	scriptPath := filepath.Join(dir, mainFile)
	scriptFile, err := os.Create(scriptPath)
	if err != nil {
		return nil, errors.Wrapf(err, "create %s", scriptPath)
	}

	replacer := strings.NewReplacer("[[JITSU_RESULT_COMMAND]]", ipc.JitsuScriptResultCommand,
		"[[JITSU_KV_GET_COMMAND]]", JitsuKvGetCommand,
		"[[JITSU_KV_SET_COMMAND]]", JitsuKvSetCommand)

	defer closeQuietly(scriptFile)
	if _, err = replacer.WriteString(scriptFile, scriptContent); err != nil {
		return nil, errors.Wrapf(err, "write to %s", scriptPath)
	}

	return &Factory{
		maxSpace:         maxSpace,
		dir:              dir,
		nodePath:         nodePath,
		plugins:          new(sync.Map),
		exchangers:       make([]*exchanger, poolSize),
		transformStorage: transformStorage,
	}, nil
}

func (f *Factory) Close() error {
	cancel, _ := f.mu.Lock(context.Background())
	defer cancel()

	for _, exchanger := range f.exchangers {
		if exchanger == nil {
			continue
		}

		_ = exchanger.Close()
	}

	_ = os.RemoveAll(f.dir)
	return nil
}

func (f *Factory) CreateScript(executable script.Executable, variables map[string]interface{}, standalone bool, includes ...string) (script.Interface, error) {
	var (
		expression string

		// for stacktrace transformation
		colOffset, rowOffset int
	)

	switch e := executable.(type) {
	case script.Expression:
		expression = string(e)
		if !strings.Contains(expression, "return") {
			colOffset = 7
			expression = "return " + strings.Trim(expression, "\n")
		}

		rowOffset = 7
		expression = `
module.exports = async (event) => {
  let $ = event
  let _ = event
  let $context = (event ?? {})['` + events.HTTPContextField + `'] ?? {}
  $context.header = (name) => (($context.headers ?? {})[name.toLowerCase()] ?? [])[0]
// expression start //
` + expression + `
// expression end //
}`

	case script.Package:
		ref, _ := f.plugins.LoadOrStore(string(e), &pluginRef{plugin: string(e)})
		plugin, err := ref.(*pluginRef).get()
		if err != nil {
			return nil, errors.Wrapf(err, "load plugin %s", string(e))
		}

		expression = plugin

	case script.File:
		data, err := os.ReadFile(string(e))
		if err != nil {
			return nil, errors.Wrapf(err, "read file %s", string(e))
		}

		expression = string(data)
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

	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	cancel, err = f.mu.Lock(ctx)
	if err != nil {
		return nil, err
	}

	defer cancel()

	var exer *exchanger
	exchangerIdx := hash % uint64(len(f.exchangers))
	if !standalone {
		exer = f.exchangers[exchangerIdx]
	}
	if exer == nil {
		process := &ipc.StdIO{
			Dir:              f.dir,
			Path:             node,
			Args:             []string{fmt.Sprintf("--max-old-space-size=%d", f.maxSpace), filepath.Join(f.dir, mainFile)},
			Env:              []string{nodePathEnv + "=" + f.nodePath, "TZ=Etc/UTC"},
			CommandProcessor: f.ProcessCustomCommand,
		}

		governor, err := ipc.Govern(process, standalone)
		if err != nil {
			return nil, errors.Wrapf(err, "govern process")
		}

		logging.Debugf("%s running in %s", governor, f.dir)
		exer = &exchanger{Governor: governor}
		if !standalone {
			f.exchangers[exchangerIdx] = exer
		}
	}

	init.Session.Session = fmt.Sprintf("%x", hash)
	return &Script{
		Init:       init,
		exchanger:  exer,
		rowOffset:  rowOffset,
		colOffset:  colOffset,
		standalone: standalone,
	}, nil
}

// KeyValueCommand is used to pass payload of key-value storage commands and results.
type KeyValueCommand struct {
	RequestId     int64   `json:"requestId"`
	DestinationId string  `json:"destinationId"`
	Key           string  `json:"key"`
	Value         *string `json:"value,omitempty"`
	TTLms         *int64  `json:"ttlMs,omitempty"`
	Success       bool    `json:"success"`
	Error         string  `json:"error"`
}

func (f *Factory) ProcessCustomCommand(command string, payload []byte) (*ipc.CommandResponse, error) {
	logging.Infof("Received custom command: %s", command)
	switch command {
	case JitsuKvGetCommand, JitsuKvSetCommand:
		kv := &KeyValueCommand{}
		err := json.Unmarshal(payload, kv)
		if err != nil {
			err = fmt.Errorf("Transform Key-Value error: failed to unmarshal kv command: %s: %w", payload, err)
			logging.SystemErrorf(err.Error())
			return nil, err
		}
		var value *string
		if command == JitsuKvGetCommand {
			value, err = f.transformStorage.GetTransformValue(kv.DestinationId, kv.Key)
		} else if kv.Value != nil {
			if len(*kv.Value) > 10000 {
				err = fmt.Errorf("Transform Key-Value Set error: value length (%d) exceeds allowed limit: %d value(trimmed):\n%s", len(*kv.Value), 10000, utils.ShortenStringWithEllipsis(*kv.Value, 200))
			} else {
				err = f.transformStorage.SetTransformValue(kv.DestinationId, kv.Key, *kv.Value, kv.TTLms)
			}
		} else {
			err = f.transformStorage.DeleteTransformValue(kv.DestinationId, kv.Key)
		}
		if err != nil {
			kv.Error = err.Error()
		} else {
			kv.Success = true
			kv.Value = value
		}
		return &ipc.CommandResponse{
			Command: command,
			Payload: kv,
		}, nil
	default:
		return nil, fmt.Errorf("unknown command: %s", command)
	}
}
