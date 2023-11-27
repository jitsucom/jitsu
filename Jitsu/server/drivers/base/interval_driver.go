package base

//IntervalDriver is a base driver for native drivers
type IntervalDriver struct {
	SourceType string
}

//GetDriversInfo returns telemetry information about the driver
func (ind *IntervalDriver) GetDriversInfo() *DriversInfo {
	return &DriversInfo{
		SourceType:      ind.SourceType,
		ConnectorOrigin: NativeConnectorType,
		Streams:         1,
	}
}

func (ind *IntervalDriver) Delete() error {
	return nil
}
