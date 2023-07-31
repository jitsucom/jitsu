package logging

import "io"

var InstanceMock *WriterMock

type WriterMock struct {
	Data [][]byte
}

func InitInMemoryWriter() io.WriteCloser {
	InstanceMock = &WriterMock{
		Data: [][]byte{},
	}
	return InstanceMock
}

func (im *WriterMock) Write(dataToWrite []byte) (n int, err error) {
	im.Data = append(im.Data, dataToWrite)
	return len(dataToWrite), nil
}

func (im *WriterMock) Close() (err error) {
	return nil
}
