package logging

import (
	"io"
)

//Dual write logs into fileWriter and into stdout as well
type Dual struct {
	fileWriter io.Writer

	stdout io.Writer
}

func (wp Dual) Write(bytes []byte) (int, error) {
	wp.stdout.Write(bytes)
	return wp.fileWriter.Write(bytes)
}
