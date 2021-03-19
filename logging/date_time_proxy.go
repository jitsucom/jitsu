package logging

import (
	"io"
	"time"

	"github.com/jitsucom/eventnative/timestamp"
)

type DateTimeWriterProxy struct {
	writer io.Writer
}

func (wp DateTimeWriterProxy) Write(bytes []byte) (int, error) {
	return wp.writer.Write([]byte(time.Now().UTC().Format(timestamp.LogsLayout) + " " + string(bytes)))
}
