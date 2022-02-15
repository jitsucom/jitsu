package middleware

import "github.com/jitsucom/jitsu/configurator/common"

type ProjectAccess struct {
	projects    common.StringSet
	adminAccess bool
}

//HasAccess returns true if there is an access permission
func (pa *ProjectAccess) HasAccess(projectID string) bool {
	return pa.projects[projectID] || pa.adminAccess
}

//IsAdmin returns true if provided token has admin access
func (pa *ProjectAccess) IsAdmin() bool {
	return pa.adminAccess
}
