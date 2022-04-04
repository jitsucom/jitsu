package ipc

import "fmt"

type Interface interface {
	Send(data []byte) error
	Receive() ([]byte, error)
}

type Process interface {
	Interface
	fmt.Stringer
	Spawn() (Process, error)
	Kill()
	Wait() error
}

type Test struct {
	in, out chan []byte
}
