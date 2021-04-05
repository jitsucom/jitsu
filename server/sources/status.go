package sources

var StatusInstance = &Status{Reloading: false}

//Status is a singleton struct for storing sources reloading state.
//Scheduler checks this flag and doesn't run Sync tasks
type Status struct {
	Reloading bool
}
