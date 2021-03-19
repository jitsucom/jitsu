package destinations

var StatusInstance = &Status{Reloading: false}

//Singleton struct for storing destinations reloading state. Uploader check this flag
//and don't upload batch files if Reloading = true
type Status struct {
	Reloading bool
}
