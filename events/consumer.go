package events

import (
	"io"
)

type Fact map[string]interface{}

type Consumer interface {
	io.Closer
	Consume(fact Fact)
}
