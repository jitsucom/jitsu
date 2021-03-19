package sources

import "github.com/jitsucom/eventnative/drivers"

type Unit struct {
	SourceType          string
	DriverPerCollection map[string]drivers.Driver
	DestinationIds      []string
}
