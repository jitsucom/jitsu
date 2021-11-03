package singer

//RawCatalog is a dto for Singer catalog serialization
type RawCatalog struct {
	Streams []map[string]interface{} `json:"streams,omitempty"`
}
