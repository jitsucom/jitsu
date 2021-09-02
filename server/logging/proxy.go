package logging

import (
	"github.com/jitsucom/jitsu/server/timestamp"
	"io"
)

type DateTimeWriterProxy struct {
	writer io.Writer
}

func (wp DateTimeWriterProxy) Write(bytes []byte) (int, error) {
	return wp.writer.Write([]byte(timestamp.Now().UTC().Format(timestamp.LogsLayout) + " " + string(bytes)))
}

type PrefixDateTimeProxy struct {
	prefix string
	writer io.Writer
}

func NewPrefixDateTimeProxy(prefix string, writer io.Writer) io.Writer {
	return &PrefixDateTimeProxy{prefix: prefix, writer: writer}
}

func (pwp PrefixDateTimeProxy) Write(bytes []byte) (int, error) {
	return pwp.writer.Write([]byte(timestamp.Now().UTC().Format(timestamp.LogsLayout) + " " + pwp.prefix + " " + string(bytes)))
}
