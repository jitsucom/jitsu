package appstatus

//Instance is a Singleton struct for storing application status.
// Some services check this flag and don't perform any actions if Idle = true
var Instance = &AppStatus{Idle: false}

//AppStatus is a dto for keeping Application State
type AppStatus struct {
	Idle bool
}
