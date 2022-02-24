package middleware

import (
	"regexp"

	"github.com/pkg/errors"

	"github.com/gin-gonic/gin"
)

const (
	bearerAuthHeader = "authorization"

	// DEPRECATED
	clientAuthHeader = "X-Client-Auth"
	// DEPRECATED
	tokenQueryParam = "token"
	// DEPRECATED
	adminTokenHeader = "X-Admin-Token"
)

var (
	tokenRe          = regexp.MustCompile(`(?i)^bearer (.+)$`)
	errInvalidToken  = errors.Errorf("Token is invalid in header: %s. Request should contain 'Authorization: Bearer <token>' header.", bearerAuthHeader)
	errTokenRequired = errors.New("token required")
)

func GetToken(ctx *gin.Context) string {
	if header := ctx.GetHeader(bearerAuthHeader); header != "" {
		if matches := tokenRe.FindAllStringSubmatch(header, -1); len(matches) > 0 && len(matches[0]) > 0 {
			return matches[0][1]
		} else {
			invalidToken(ctx, errInvalidToken)
		}
	}

	if query := ctx.Request.URL.Query(); query.Has(tokenQueryParam) {
		return query.Get(tokenQueryParam)
	}

	if header := ctx.GetHeader(adminTokenHeader); header != "" {
		return header
	}

	if header := ctx.GetHeader(clientAuthHeader); header != "" {
		return header
	}

	tokenRequired(ctx, errTokenRequired)
	return ""
}

func invalidToken(ctx *gin.Context, err error) {
	ctx.Writer.Header().Set("WWW-Authenticate", "Bearer realm=\"invalid_token\" error=\"invalid_token\"")
	Unauthorized(ctx, err)
}

func tokenRequired(ctx *gin.Context, err error) {
	ctx.Writer.Header().Set("WWW-Authenticate", "Bearer realm=\"token_required\"")
	Unauthorized(ctx, err)
}
