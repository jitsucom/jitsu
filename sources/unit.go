package sources

import "github.com/ksensehq/eventnative/drivers"

type Unit struct {
	DriverPerCollection map[string]drivers.Driver
	DestinationIds      []string
}
