package logging

import (
	"io"
)

//Dual write logs into fileWriter and into stdout as well
type Dual struct {
	FileWriter io.Writer
	Stdout     io.Writer
}

func (wp Dual) Write(bytes []byte) (int, error) {
	wp.Stdout.Write(bytes)
	return wp.FileWriter.Write(bytes)
}
