package entities

type ProjectSettings struct {
	Notifications *Notifications `json:"notifications" firebase:"notifications"`
}
