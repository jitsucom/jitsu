package logging

import "io"

type ObjectLogger interface {
	io.Closer
	Consume(event map[string]interface{}, tokenID string)
	ConsumeAny(obj interface{})
}
