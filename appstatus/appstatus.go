package appstatus

var Instance = &AppStatus{Idle: false}

type AppStatus struct {
	Idle bool
}
