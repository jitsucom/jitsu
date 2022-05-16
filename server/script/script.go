package script

import (
	"encoding/json"
	"errors"
	"time"
)

// Executable is an entity which can be loaded as Interface.
// This is an algebraic type with no logic of its own.
// Factory implementations are responsible for implementing processing logic for relevant Executables.
type Executable interface {
	executable() Executable
}

// Expression is a piece of code with no external requirements, generally representing a function body.
// Implements Executable interface.
type Expression string

func (e Expression) executable() Executable {
	return e
}

// Package is an external package which should be obtained before loading.
// Package format specification depends on the Factory implementation.
// Implements Executable interface.
type Package string

func (p Package) executable() Executable {
	return p
}

// File is the executable script path.
// This exists mainly for tests to emulate the Package, but without the hassle of providing a valid package.
// Implements Executable interface.
type File string

func (f File) executable() Executable {
	return f
}

// Symbol represents a JavaScript value.
type Symbol struct {

	// Type is the symbol type and corresponds to JavaScript's `typeof`.
	Type string `json:"type"`

	// Value is the symbol value.
	// It is nil when the symbol is a function.
	Value json.RawMessage `json:"value,omitempty"`
}

// As unmarshals the symbol Value into a value.
func (s Symbol) As(value interface{}) error {
	if s.Value == nil {
		return errors.New("symbol is a function")
	}

	return json.Unmarshal(s.Value, value)
}

// Symbols is a named Symbol map.
type Symbols map[string]Symbol

type Args = []interface{}

// Listener interface is used to collect execution "side-effects".
type Listener interface {

	// Data is executed on each line of resulting multiline stream.
	Data(data []byte)

	// Log is executed for each log record generated during execution.
	Log(level, message string)

	// Timeout to use for execution.
	Timeout() time.Duration
}

// Interface defines the loaded Executable.
type Interface interface {

	// Describe returns exported Symbols.
	Describe() (Symbols, error)

	// Execute executes a function with the provided `name` and `args` and collects the execution result into `result`.
	// Execution result maybe multiline stream that will be written into provided Listener.
	Execute(name string, args Args, result interface{}, listener Listener) error

	// Close disposes of the instance and releases associated resources.
	Close()
}

// Factory loads an Executable.
type Factory interface {

	// CreateScript loads an Executable and returns an Interface instance for using it.
	// `variables` are the global variables to be made available for Executable.
	// `includes` are code snippets to embed into script.
	CreateScript(executable Executable, variables map[string]interface{}, standalone bool, includes ...string) (Interface, error)
}
