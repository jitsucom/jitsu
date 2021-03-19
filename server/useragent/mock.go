package useragent

var MockData = &ResolvedUa{
	UaFamily:     "Chrome",
	UaVersion:    "1.0.0",
	OsFamily:     "Windows",
	OsVersion:    "95",
	DeviceFamily: "PK",
}

type Mock struct{}

func (Mock) Resolve(ua string) *ResolvedUa {
	return MockData
}
