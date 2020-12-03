package sources

import "github.com/jitsucom/eventnative/drivers"

type Unit struct {
	DriverPerCollection map[string]drivers.Driver
	DestinationIds      []string
}
