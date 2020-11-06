package drivers

import "io"

type Driver interface {
	io.Closer
	GetAllAvailableIntervals() ([]*TimeInterval, error)
	GetObjectsFor(interval *TimeInterval) ([]map[string]interface{}, error)

	Type() string
}
