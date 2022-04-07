package templates

import (
	"encoding/json"
	"fmt"

	"github.com/jitsucom/jitsu/server/script/node"

	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/script"
	"github.com/pkg/errors"
)

type nodeScript interface {
	fmt.Stringer
	executable() script.Executable
	init(s script.Interface) error
	validate(s script.Interface) error
	transform(s script.Interface, event events.Event) (interface{}, error)
}

type Expression string

func (e Expression) String() string {
	return string(e)
}

func (e Expression) init(s script.Interface) error {
	return nil
}

func (e Expression) executable() script.Executable {
	return script.Expression(e)
}

func (e Expression) validate(s script.Interface) error {
	return nil
}

func (e Expression) transform(s script.Interface, event events.Event) (interface{}, error) {
	var value interface{}
	if err := s.Execute("", script.Args{event}, &value); err != nil {
		return nil, err
	}

	return value, nil
}

type DestinationPlugin struct {
	Package string
	ID      string
	Type    string
	Config  map[string]interface{}

	validateFunc string
	execFunc     string
	execArgs     script.Args
}

func (p *DestinationPlugin) String() string {
	return p.Package
}

func (p *DestinationPlugin) executable() script.Executable {
	return script.Package(p.Package)
}

func (p *DestinationPlugin) init(s script.Interface) error {
	symbols, err := s.Describe()
	if err != nil {
		return errors.Wrap(err, "get plugin symbols")
	}

	execArg := map[string]interface{}{
		"destinationId":    p.ID,
		"destionationType": p.Type,
		"config":           p.Config,
	}

	if buildInfo, ok := symbols["buildInfo"]; ok && buildInfo.Type == "object" {
		var value script.BuildInfo
		if err := buildInfo.As(&value); err != nil {
			return errors.Wrap(err, "parse plugin buildInfo")
		}

		if value.SdkVersion != "" {
			if symbol, ok := symbols["destination"]; ok && symbol.Type == "function" {
				p.execFunc = "destination"
				p.execArgs = script.Args{execArg}
			}
		}
	}

	if p.execFunc == "" {
		if symbol, ok := symbols["adapter"]; ok && symbol.Type == "function" {
			p.execFunc = "adapter"
			for key, value := range p.Config {
				execArg[key] = value
			}

			p.execArgs = script.Args{execArg}
		} else {
			return errors.New("no 'destination' or 'adapter' functions found in plugin")
		}
	}

	if symbol, ok := symbols["validator"]; ok && symbol.Type == "function" {
		p.validateFunc = "validator"
	}

	return nil
}

func (p *DestinationPlugin) validate(s script.Interface) error {
	if p.validateFunc == "" {
		return nil
	}

	var result json.RawMessage
	if err := s.Execute(p.validateFunc, script.Args{p.Config}, &result); err != nil {
		return err
	}

	var (
		ok     bool
		errMsg string
		desc   struct {
			Ok      bool   `json:"ok"`
			Message string `json:"message"`
		}
	)

	if err := json.Unmarshal(result, &ok); err == nil {
		if !ok {
			return errors.New("validation failed")
		}
	} else if err := json.Unmarshal(result, &errMsg); err == nil {
		return errors.New(errMsg)
	} else if err := json.Unmarshal(result, &desc); err == nil {
		if !desc.Ok {
			return errors.New(desc.Message)
		}
	} else {
		return errors.Errorf("failed to decode validation result '%s'", string(result))
	}

	return nil
}

func (p *DestinationPlugin) transform(s script.Interface, event events.Event) (interface{}, error) {
	var result interface{}
	if err := s.Execute(p.execFunc, append([]interface{}{event}, p.execArgs...), &result); err != nil {
		return nil, err
	}

	return result, nil
}

type NodeExecutor struct {
	script.Interface
	nodeScript
}

func NewNodeExecutor(nodeScript nodeScript, variables map[string]interface{}, includes ...string) (*NodeExecutor, error) {
	instance, err := node.Factory().CreateScript(nodeScript.executable(), variables, includes...)
	if err != nil {
		return nil, errors.Wrap(err, "spawn node process")
	}

	if err := nodeScript.init(instance); err != nil {
		instance.Close()
		return nil, errors.Wrap(err, "init node script instance")
	}

	return &NodeExecutor{
		Interface:  instance,
		nodeScript: nodeScript,
	}, nil
}

func (e *NodeExecutor) Validate() error {
	return e.validate(e)
}

func (e *NodeExecutor) ProcessEvent(event events.Event) (interface{}, error) {
	return e.transform(e, event)
}

func (e *NodeExecutor) Format() string {
	return "javascript"
}

func (e *NodeExecutor) Expression() string {
	return e.String()
}
