package appstatus

import "go.uber.org/atomic"

//Instance is a Singleton struct for storing application status.
// Some services check this flag and don't perform any actions if Idle = true
var Instance = &AppStatus{
	Idle: atomic.NewBool(false),
}

//AppStatus is a dto for keeping Application State
type AppStatus struct {
	Idle *atomic.Bool
}
