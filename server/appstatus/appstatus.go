package appstatus

var Instance = &AppStatus{Idle: false}

//Singleton struct for storing application status. Some services check this flag
//and don't perform any actions if Idle = true
type AppStatus struct {
	Idle bool
}
