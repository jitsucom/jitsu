package sources

import "github.com/jitsucom/eventnative/drivers"

type Unit struct {
	DriverPerCollection map[*drivers.Collection]drivers.Driver
	DestinationIds      []string
}
