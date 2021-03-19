package sources

import "github.com/jitsucom/eventnative/server/drivers"

type Unit struct {
	SourceType          string
	DriverPerCollection map[string]drivers.Driver
	DestinationIds      []string
}
