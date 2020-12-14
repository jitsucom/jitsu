package fallback

import "github.com/jitsucom/eventnative/logfiles"

type FileStatus struct {
	FileName      string                      `json:"file_name"`
	DestinationId string                      `json:"destination_id"`
	TablesStatus  map[string]*logfiles.Status `json:"tables_statuses"`
}
