package fallback

import "github.com/jitsucom/jitsu/server/logfiles"

type FileStatus struct {
	FileName      string                      `json:"file_name"`
	DestinationID string                      `json:"destination_id"`
	TablesStatus  map[string]*logfiles.Status `json:"tables_statuses"`
}
