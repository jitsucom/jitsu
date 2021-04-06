package drivers

import (
	"io"
)

//Driver interface must be implemented by every source type
type Driver interface {
	io.Closer
	//GetAllAvailableIntervals return all the available time intervals for data loading. It means, that if you want
	//your driver to load for the last year by month chunks, you need to return 12 time intervals, each covering one
	//month. There is drivers/granularity.ALL for data sources that store data which may not be split by date.
	GetAllAvailableIntervals() ([]*TimeInterval, error)
	//GetObjectsFor returns slice of objects per time interval. Each slice element is one object from the data source.
	GetObjectsFor(interval *TimeInterval) ([]map[string]interface{}, error)
	//Type returns string type of driver. Should be unique among drivers
	Type() string
	//GetCollectionTable returns table name
	GetCollectionTable() string
	//TestConnection returns error if can't do anything
	TestConnection() error
}
