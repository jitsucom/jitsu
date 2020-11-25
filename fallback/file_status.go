package fallback

type FileStatus struct {
	FileName      string `json:"file_name"`
	DestinationId string `json:"destination_id"`
	Uploaded      bool   `json:"uploaded"`
	Error         string `json:"error,omitempty"`
}
