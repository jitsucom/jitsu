package destinations

var StatusInstance = &Status{Reloading: false}

//Status is a singleton struct for storing destinations reloading state.
//Uploader checks this flag and doesn't upload batch files if Reloading = true
type Status struct {
	Reloading bool
}
