package errors

type Id int64

const (
	GlobalPanic Id = iota
)

type Incident struct {
	log bool
}

func New() *Incident {
	return &Incident{}
}

func WithLog() *Incident {
	return &Incident{log: true}
}

func (i Incident) GettingInstanceId() {
	if i.log {

	}
}
