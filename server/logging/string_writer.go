package logging

import "bytes"

type StringWriter struct {
	buff *bytes.Buffer
}

func NewStringWriter() *StringWriter {
	return &StringWriter{
		buff: bytes.NewBuffer([]byte{}),
	}
}

func (sw *StringWriter) String() string {
	return sw.buff.String()
}

func (sw *StringWriter) Bytes() []byte {
	return sw.buff.Bytes()
}

func (sw *StringWriter) Write(p []byte) (n int, err error) {
	return sw.buff.Write(p)
}

func (sw *StringWriter) Close() error {
	return nil
}
