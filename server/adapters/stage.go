package adapters

import "io"

type Stage interface {
	io.Closer
	UploadBytes(fileName string, fileBytes []byte) error
	ListBucket(prefix string) ([]string, error)
	GetObject(name string) ([]byte, error)
	DeleteObject(key string) error
}
