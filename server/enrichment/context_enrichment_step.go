package enrichment

import (
	"fmt"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/identifiers"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/timestamp"
	"github.com/jitsucom/jitsu/server/uuid"
	"net/http"
	"strings"
)

const (
	apiTokenKey = "api_key"
	ipKey       = "source_ip"
)

//ContextEnrichmentStep enriches payload with ip, user-agent, token, unique ID field (event_id) and _timestamp
func ContextEnrichmentStep(payload events.Event, token string, r *http.Request, preprocessor events.Processor,
	uniqueIDField *identifiers.UniqueID) {
	//1. source IP (don't override income value)
	if _, ok := payload[ipKey]; !ok {
		ip := extractIP(r)
		if ip != "" {
			payload[ipKey] = ip
		}
	}

	//2. preprocess
	preprocessor.Preprocess(payload, r)

	//3. unique ID field
	//extract 1.0 format -> 1.0 flat format -> 2.0 format
	eventID := uniqueIDField.ExtractAndRemove(payload)
	if eventID == "" {
		eventID = uuid.New()
	}
	//set into flat field
	if err := uniqueIDField.Set(payload, fmt.Sprint(eventID)); err != nil {
		logging.SystemError("Error setting flat unique ID into the object %s: %v", payload.Serialize(), err)
	}

	//4. timestamp & api key
	payload[apiTokenKey] = token
	payload[timestamp.Key] = timestamp.NowUTC()
}

func extractIP(r *http.Request) string {
	ip := r.Header.Get("X-Real-IP")
	if ip == "" {
		ip = r.Header.Get("X-Forwarded-For")
	}
	if ip == "" {
		remoteAddr := r.RemoteAddr
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
