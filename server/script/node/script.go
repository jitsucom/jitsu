package node

import (
	_ "embed"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/jitsucom/jitsu/server/script"
	"github.com/jitsucom/jitsu/server/script/ipc"
	"github.com/pkg/errors"
)

var maxScriptErrors = 3

type Session struct {
	Session string `json:"session"`
}

type Init struct {
	Session
	Executable string                 `json:"executable"`
	Variables  map[string]interface{} `json:"variables,omitempty"`
	Includes   []string               `json:"includes,omitempty"`
}

type Execute struct {
	Session
	Function string        `json:"function,omitempty"`
	Args     []interface{} `json:"args"`
}

type Script struct {
	*Init
	exchanger  *exchanger
	colOffset  int
	rowOffset  int
	errCount   int
	standalone bool
}

func (s *Script) Describe() (script.Symbols, error) {
	value := make(script.Symbols)
	if err := s.exchange(describe, s.Session, &value, nil); err != nil {
		return nil, err
	}

	return value, nil
}

func (s *Script) Execute(name string, args []interface{}, result interface{}, listener script.Listener) error {
	if args == nil {
		args = make([]interface{}, 0)
	}

	return s.exchange(execute, Execute{Session: s.Session, Function: name, Args: args}, result, listener)
}

func (s *Script) Close() {
	if s.exchanger != nil {
		_ = s.exchanger.exchangeDirect(unload, s.Session, nil, nil)
		if s.standalone {
			s.exchanger.Kill()
			s.exchanger = nil
		}
	}
}

var vmStackTraceLineRegex = `^\s*at\s(.*?)\s\(.*?%s\.js:(\d+):(\d+)\)$`

func (s *Script) exchange(command string, payload, result interface{}, listener script.Listener) error {
	err := s.exchanger.exchange(command, payload, result, listener)
	if errors.Is(err, ipc.ErrOutOfMemory) {
		s.errCount++
		if s.errCount >= maxScriptErrors {
			return err
		}

		return s.exchange(command, payload, result, listener)
	}

	switch {
	case err == nil:
		s.errCount = 0
		return nil
	case errors.Is(err, errLoadRequired):
		if err := s.exchanger.exchange(load, s.Init, nil, nil); err != nil {
			return s.rewriteJavaScriptStack(err)
		}

		return s.exchange(command, payload, result, listener)
	default:
		s.errCount = 0
		return s.rewriteJavaScriptStack(err)
	}
}

func (s *Script) rewriteJavaScriptStack(err error) error {
	var jsErr jsError
	if !errors.As(err, &jsErr) {
		return err
	}

	if jsErr.stack == "" {
		return err
	}

	regex := regexp.MustCompile(fmt.Sprintf(vmStackTraceLineRegex, s.Session.Session))
	lines := strings.Split(jsErr.stack, "\n")
	stack := make([]string, 0)
	for i, line := range lines {
		if i == 0 {
			continue
		}

		match := regex.FindStringSubmatch(line)
		if len(match) == 0 {
			continue
		}

		function := match[1]
		if function == "module.exports" {
			function = "main"
		}

		row, _ := strconv.Atoi(match[2])
		row -= s.rowOffset + 1 + len(s.Init.Includes)
		if row < 0 {
			return err
		}

		column, _ := strconv.Atoi(match[3])
		if row == 1 {
			column -= s.colOffset
		}

		stack = append(stack, fmt.Sprintf(`  at %s (%d:%d)`, function, row, column))
	}

	jsErr.stack = strings.Trim(jsErr.message+"\n"+strings.Join(stack, "\n"), "\n")
	return jsErr
}
