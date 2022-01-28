package middleware

type ProjectAccess struct {
	projects    map[string]bool
	adminAccess bool
}

//HasAccess returns true if there is an access permission
func (pa *ProjectAccess) HasAccess(projectID string) bool {
	_, ok := pa.projects[projectID]
	return ok || pa.adminAccess
}
