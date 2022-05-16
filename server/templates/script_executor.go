package templates

import (
	"encoding/json"

	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/script"
	"github.com/pkg/errors"
)

var scriptFactory script.Factory = script.DummyFactory

func SetScriptFactory(newScriptFactory script.Factory) {
	scriptFactory = newScriptFactory
}

type nodeScript interface {
	String() string
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
	if err := s.Execute("", script.Args{event}, &value, nil); err != nil {
		return nil, err
	}

	return value, nil
}

type DestinationPlugin struct {
	Package string
	ID      string
	Type    string
	Config  map[string]interface{}

	buildInfo    buildInfo
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
		"destinationId":   p.ID,
		"destinationType": p.Type,
		"config":          p.Config,
	}

	if symbol, ok := symbols["buildInfo"]; ok && symbol.Type == "object" {
		var value buildInfo
		if err := symbol.As(&value); err != nil {
			return errors.Wrap(err, "parse plugin buildInfo")
		}
		p.buildInfo = value
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
	if err := s.Execute(p.validateFunc, script.Args{p.Config}, &result, nil); err != nil {
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
	if err := s.Execute(p.execFunc, append(script.Args{event}, p.execArgs...), &result, nil); err != nil {
		return nil, err
	}

	return result, nil
}

type SourcePlugin struct {
	Package string
	ID      string
	Type    string
	Config  map[string]interface{}

	buildInfo    buildInfo
	validateFunc string
	specObject   map[string]interface{}
	catalogFunc  string
	execFunc     string
}

func (s *SourcePlugin) String() string {
	return s.Package
}

func (s *SourcePlugin) executable() script.Executable {
	return script.Package(s.Package)
}

func (s *SourcePlugin) init(scr script.Interface) error {
	symbols, err := scr.Describe()
	if err != nil {
		return errors.Wrap(err, "get plugin symbols")
	}

	if symbol, ok := symbols["descriptor"]; ok && symbol.Type == "object" {
		descMap := map[string]interface{}{}
		if err := symbol.As(&descMap); err != nil {
			return errors.Wrap(err, "parse plugin descriptor")
		}

		s.specObject = descMap
	} else {
		return errors.New("no 'descriptor' object found in plugin")
	}

	if symbol, ok := symbols["buildInfo"]; ok && symbol.Type == "object" {
		var value buildInfo
		if err := symbol.As(&value); err != nil {
			return errors.Wrap(err, "parse plugin buildInfo")
		}
		s.buildInfo = value
	}

	if symbol, ok := symbols["streamReader$StdoutFacade"]; ok && symbol.Type == "function" {
		s.execFunc = "streamReader$StdoutFacade"
	} else {
		return errors.New("required 'streamer' function is missing in plugin")
	}

	if symbol, ok := symbols["sourceCatalog"]; ok && symbol.Type == "function" {
		s.catalogFunc = "sourceCatalog"
	} else {
		return errors.New("required 'catalogue' function is missing in plugin")
	}

	if symbol, ok := symbols["validator"]; ok && symbol.Type == "function" {
		s.validateFunc = "validator"
	}

	return nil
}

func (s *SourcePlugin) validate(scr script.Interface) error {
	if s.validateFunc == "" {
		return nil
	}

	var result json.RawMessage
	if err := scr.Execute(s.validateFunc, script.Args{s.Config}, &result, nil); err != nil {
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

func (s *SourcePlugin) spec(scr script.Interface) map[string]interface{} {
	return s.specObject
}

func (s *SourcePlugin) catalog(scr script.Interface) (interface{}, error) {
	var result interface{}
	if err := scr.Execute(s.catalogFunc, script.Args{s.Config}, &result, nil); err != nil {
		return nil, err
	}

	return result, nil
}

func (s *SourcePlugin) stream(scr script.Interface, streamName string, configuration interface{}, state interface{}, listener script.Listener) (interface{}, error) {
	var result interface{}
	if err := scr.Execute(s.execFunc, script.Args{s.Config, streamName, configuration, state}, &result, listener); err != nil {
		return nil, err
	}

	return result, nil
}

type SourceExecutor struct {
	script.Interface
	*SourcePlugin
}

func NewSourceExecutor(sourcePlugin *SourcePlugin) (*SourceExecutor, error) {
	instance, err := scriptFactory.CreateScript(sourcePlugin.executable(), nil, true)
	if err != nil {
		return nil, errors.Wrap(err, "spawn node process")
	}

	if err := sourcePlugin.init(instance); err != nil {
		instance.Close()
		return nil, errors.Wrap(err, "init node script instance")
	}

	return &SourceExecutor{
		Interface:    instance,
		SourcePlugin: sourcePlugin,
	}, nil
}

func (e *SourceExecutor) Validate() error {
	return e.validate(e)
}

func (e *SourceExecutor) Spec() map[string]interface{} {
	return e.spec(e)
}

func (e *SourceExecutor) Catalog() (interface{}, error) {
	return e.catalog(e)
}

func (e *SourceExecutor) Stream(streamName string, configuration interface{}, state interface{}, listener script.Listener) (interface{}, error) {
	return e.stream(e, streamName, configuration, state, listener)
}

type NodeExecutor struct {
	script.Interface
	nodeScript
}

func NewScriptExecutor(nodeScript nodeScript, variables map[string]interface{}, includes ...string) (*NodeExecutor, error) {
	instance, err := scriptFactory.CreateScript(nodeScript.executable(), variables, false, includes...)
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

type buildInfo struct {
	SdkVersion     string `json:"sdkVersion"`
	SdkPackage     string `json:"sdkPackage"`
	BuildTimestamp string `json:"buildTimestamp"`
}
