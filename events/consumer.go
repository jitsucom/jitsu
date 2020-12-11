package events

import (
	"io"
)

type Consumer interface {
	io.Closer
	Consume(event map[string]interface{}, tokenId string)
}
