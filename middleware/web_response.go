package middleware

type ErrorResponse struct {
	Message string `json:"message"`
	Error   error  `json:"error"`
}

type StatusResponse struct {
	Status string `json:"status"`
}

func OkResponse() StatusResponse {
	return StatusResponse{Status: "ok"}
}
