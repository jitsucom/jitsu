package geo

type EditionStatus string

const (
	StatusOK      EditionStatus = "ok"
	StatusError   EditionStatus = "error"
	StatusUnknown EditionStatus = "unknown"
)

//EditionRule is a dto for returning edition statuses
type EditionRule struct {
	Main   *EditionData `json:"main"`
	Analog *EditionData `json:"analog"`
}

//EditionData is a dto for describing edition status
type EditionData struct {
	Name    Edition       `json:"name"`
	Status  EditionStatus `json:"status"`
	Message string        `json:"message"`
}
