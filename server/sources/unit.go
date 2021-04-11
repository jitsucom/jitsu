package sources

import (
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/drivers"
)

type Unit struct {
	SourceType          string
	DriverPerCollection map[string]drivers.Driver
	DestinationIDs      []string

	hash uint64
}

//Close all drivers
func (u *Unit) Close() (multiErr error) {
	for _, driver := range u.DriverPerCollection {
		if err := driver.Close(); err != nil {
			multiErr = multierror.Append(multiErr, err)
		}
	}

	return
}
