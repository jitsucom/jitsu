package middleware

type OkResponse struct {
	Status string `json:"status"`
}

type ErrorResponse struct {
	Message string `json:"message"`
	Error   error  `json:"error"`
}
