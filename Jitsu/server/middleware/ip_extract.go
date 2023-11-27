package middleware

import (
	"github.com/gin-gonic/gin"
	"strings"
)

//ExtractIP extracts IP from the input request
func ExtractIP(c *gin.Context) string {
	ip := c.Request.Header.Get("X-Forwarded-For")

	if ip == "" {
		remoteAddr := c.Request.RemoteAddr
		if remoteAddr != "" {
			addrPort := strings.Split(remoteAddr, ":")
			ip = addrPort[0]
		}
	}

	//Case when Nginx concatenate remote_addr to client addr
	if strings.Contains(ip, ",") {
		addresses := strings.Split(ip, ",")
		return strings.TrimSpace(addresses[0])
	}

	return ip
}
