package appbase

import (
	"crypto/sha512"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jitsucom/bulker/jitsubase/logging"
	"github.com/jitsucom/bulker/jitsubase/types"
	"github.com/jitsucom/bulker/jitsubase/utils"
	"github.com/jitsucom/bulker/jitsubase/uuid"
)

const ContextLoggerName = "contextLogger"
const ContextDomain = "contextDomain"
const ContextMessageId = "contextMessageId"

var EmptyGif = []byte{
	0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00,
	0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0xFF, 0xFF, 0xFF, 0x21,
	0xF9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2C, 0x00, 0x00,
	0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44,
	0x01, 0x00, 0x3B,
}

var IsHexRegex = regexp.MustCompile(`^[a-fA-F0-9]+$`)

var repeatedErrors = sync.Map{}

func init() {
	ticker := time.NewTicker(5 * time.Minute)
	go func() {
		for range ticker.C {
			repeatedErrors.Range(func(key, value interface{}) bool {
				ptr := value.(*int)
				logging.Errorf("[REPEATED:%d] %s", *ptr, key)
				return true
			})
			repeatedErrors.Clear()
		}
	}()
}

type Router struct {
	Service
	engine        *gin.Engine
	authTokens    []string
	rawAuthTokens []string
	tokenSecrets  []string
	noAuthPaths   types.Set[string]
}

func NewRouterBase(config Config, noAuthPaths []string) *Router {
	authTokens := strings.Split(config.AuthTokens, ",")
	rawAuthTokens := strings.Split(config.RawAuthTokens, ",")
	tokenSecrets := strings.Split(config.TokenSecrets, ",")
	base := NewServiceBase("router")
	if config.AuthTokens == "" {
		authTokens = nil
	}
	if config.RawAuthTokens == "" {
		rawAuthTokens = nil
	}
	if authTokens == nil && rawAuthTokens == nil {
		base.Warnf("⚠️ No auth tokens provided. All requests will be allowed")
	}
	for _, authToken := range authTokens {
		if !strings.Contains(authToken, ".") {
			base.Fatalf("Invalid auth token: %s Should be in format ${salt}.${hash} or RAW_AUTH_TOKENS config variable must be used instead", authToken)
		}
	}

	router := &Router{
		Service:       base,
		authTokens:    authTokens,
		rawAuthTokens: rawAuthTokens,
		tokenSecrets:  tokenSecrets,
		noAuthPaths:   types.NewSet(noAuthPaths...),
	}
	gin.SetMode(gin.ReleaseMode)
	engine := gin.New()
	engine.Use(gin.Recovery())
	engine.Use(router.authMiddleware)
	engine.RemoveExtraSlash = true
	router.engine = engine
	return router
}

// Engine returns gin router
func (r *Router) Engine() *gin.Engine {
	return r.engine
}

func (r *Router) authMiddleware(c *gin.Context) {
	if len(r.authTokens) == 0 && len(r.rawAuthTokens) == 0 {
		return
	}
	if r.noAuthPaths.Contains(c.FullPath()) {
		//no auth for this path
		return
	}
	authorizationHeader := c.GetHeader("Authorization")
	token := strings.TrimPrefix(authorizationHeader, "Bearer ")
	if token == "" {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Authorization header with Bearer token is required"})
		return
	}
	for _, authToken := range r.authTokens {
		hashedToken := strings.Split(authToken, ".")
		salt := hashedToken[0]
		hash := hashedToken[1]
		hex := IsHexRegex.MatchString(hash)
		for _, secret := range r.tokenSecrets {
			if hex {
				if HashTokenHex(token, salt, utils.Nvl(secret, DefaultSeed)) == hash {
					return
				}
			} else if HashTokenBase64(token, salt, secret) == hash {
				//logging.Debugf("Token %s is valid", token)
				return
			}
		}
	}
	for _, rawAuthToken := range r.rawAuthTokens {
		if token == rawAuthToken {
			return
		}
	}
	c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid token: " + token})
	return
}

func (r *Router) ResponseError(c *gin.Context, code int, errorType string, maskError bool, err error, sendResponse bool, logError bool, aggregateLogs bool) *RouterError {
	routerError := RouterError{ErrorType: errorType}
	if err != nil {
		if maskError {
			errorID := uuid.NewLettersNumbers()
			err = fmt.Errorf("error# %s: %s: %v", errorID, errorType, err)
			routerError.PublicError = errors.New("error# " + errorID + ": " + errorType)
		} else {
			err = fmt.Errorf("%s: %v", errorType, err)
			routerError.PublicError = err
		}
	} else {
		err = errors.New(errorType)
		routerError.PublicError = err
	}
	routerError.Error = err
	if logError || logging.IsDebugEnabled() {
		builder := strings.Builder{}
		loggerName := c.GetString(ContextLoggerName)
		if loggerName != "" {
			builder.WriteString("[" + loggerName + "]")
		}
		if !aggregateLogs {
			messageId := c.GetString(ContextMessageId)
			if messageId != "" {
				builder.WriteString("[messageId: " + messageId + "]")
			}
		}
		domain := c.GetString(ContextDomain)
		if domain != "" {
			builder.WriteString("[domain: " + domain + "]")
		}
		builder.WriteString(" " + fmt.Sprint(err))
		if logError {
			if aggregateLogs {
				e := r.NewError(builder.String())
				var newValue int
				val, _ := repeatedErrors.LoadOrStore(e.Error(), &newValue)
				ptr := val.(*int)
				*ptr++
			} else {
				r.Errorf(builder.String())
			}
		} else {
			r.Debugf(builder.String())
		}
	}
	if sendResponse {
		if c.FullPath() == "/api/px/:tp" {
			c.Header("X-Jitsu-Error", routerError.PublicError.Error())
			c.Data(http.StatusOK, "image/gif", EmptyGif)
		} else {
			c.JSON(code, gin.H{"error": routerError.PublicError.Error()})
		}
	}
	return &routerError
}

func (r *Router) ShouldCompress(req *http.Request) bool {
	if !strings.Contains(req.Header.Get("Accept-Encoding"), "gzip") ||
		strings.Contains(req.Header.Get("Connection"), "Upgrade") ||
		strings.Contains(req.Header.Get("Accept"), "text/event-stream") {
		return false
	}

	return true
}

// Deprecated: Use HashTokenHex. Not sure how we started to use base64 encoding for hash.
// But for compatibility with previous release we must keep it for a while
func HashTokenBase64(token string, salt string, secret string) string {
	//logging.Infof("Hashing token: %s. Salt: %s. Secret: %s", token, salt, secret)
	hash := sha512.New()
	hash.Write([]byte(token + salt + secret))
	return base64.RawStdEncoding.EncodeToString(hash.Sum(nil))
}

func HashTokenHex(token string, salt string, secret string) string {
	hash := sha512.New()
	hash.Write([]byte(token + salt + secret))
	res := hash.Sum(nil)
	return fmt.Sprintf("%x", res)
}

type RouterError struct {
	Error       error
	PublicError error
	ErrorType   string
}
