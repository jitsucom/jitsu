package logging

import (
	"io"
	"time"
)

type DateTimeWriterProxy struct {
	writer io.WriteCloser
}

func (wp DateTimeWriterProxy) Write(bytes []byte) (int, error) {
	return wp.writer.Write([]byte(time.Now().UTC().Format("2006-01-02 15:04:05") + " " + string(bytes)))
}
