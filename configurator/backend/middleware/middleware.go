package middleware

import "errors"

const (
	ProjectIDQuery = "project_id"
)

var (
	ErrIsAnonymous = errors.New("please use personalized token for this call")
)
