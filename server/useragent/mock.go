package useragent

var mockData = &ResolvedUa{
	UaFamily:     "Chrome",
	UaVersion:    "1.0.0",
	OsFamily:     "Windows",
	OsVersion:    "95",
	DeviceFamily: "PK",
}

//Mock it is used for returning mocked user-agent object instead of resolving
type Mock struct{}

//Resolve returns mocked prased user-agent object
func (Mock) Resolve(ua string) *ResolvedUa {
	return mockData
}
