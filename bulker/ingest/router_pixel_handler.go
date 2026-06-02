package main

import (
	"encoding/base64"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"

	kafka2 "github.com/confluentinc/confluent-kafka-go/v2/kafka"
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/bulker/eventslog"
	"github.com/jitsucom/bulker/jitsubase/appbase"
	"github.com/jitsucom/bulker/jitsubase/jsonorder"
	"github.com/jitsucom/bulker/jitsubase/timestamp"
	"github.com/jitsucom/bulker/jitsubase/types"
	"github.com/jitsucom/bulker/jitsubase/utils"
	"github.com/jitsucom/bulker/jitsubase/uuid"
	"golang.org/x/net/publicsuffix"
)

const (
	dataField         = "data"
	cookieDomainField = "cookie_domain"
	redirectUrlField  = "destination_url"
	processHeaders    = "process_headers"
	anonymousIdCookie = "__eventn_id"
	userIdCookie      = "__eventn_uid"
	userTraitsCookie  = "__eventn_id_usr"
	groupIdCookie     = "__group_id"
	groupTraitsCookie = "__group_traits"
)

func (r *Router) PixelHandler(c *gin.Context) {
	domain := ""
	// TODO: use workspaceId as default for all stream identification errors
	metricsId := "UNKNOWN"
	var rError *appbase.RouterError
	var ingestMessageBytes []byte
	var asyncDestinations []string
	ingestType := IngestTypeWriteKeyDefined
	var messageId string

	defer func() {
		if len(ingestMessageBytes) > 0 {
			_ = r.backupsLogger.Log(metricsId, ingestMessageBytes)
		}
		IngestedMessagesReceived(metricsId, "received").Inc()
		if rError != nil && rError.ErrorType != ErrNoDst {
			IngestedMessagesReceived(metricsId, "errors").Inc()
			obj := map[string]any{"body": string(ingestMessageBytes), "error": rError.PublicError.Error(), "status": utils.Ternary(rError.ErrorType == ErrThrottledType, "SKIPPED", "FAILED")}
			r.eventsLogService.PostAsync(&eventslog.ActorEvent{EventType: eventslog.EventTypeIncoming, Level: eventslog.LevelError, ActorId: metricsId, Event: obj})
			IngestHandlerRequests(domain, utils.Ternary(rError.ErrorType == ErrThrottledType, "throttled", "error"), rError.ErrorType).Inc()
			_ = r.producer.ProduceAsync(r.config.KafkaDestinationsDeadLetterTopicName, uuid.New(), utils.TruncateBytes(ingestMessageBytes, r.config.MaxIngestPayloadSize), map[string]string{"error": rError.Error.Error()}, kafka2.PartitionAny, messageId, false, 0)
		} else {
			obj := map[string]any{"body": string(ingestMessageBytes), "asyncDestinations": asyncDestinations}
			if len(asyncDestinations) > 0 {
				obj["status"] = "SUCCESS"
			} else {
				obj["status"] = "SKIPPED"
				obj["error"] = ErrNoDst
			}
			r.eventsLogService.PostAsync(&eventslog.ActorEvent{EventType: eventslog.EventTypeIncoming, Level: eventslog.LevelInfo, ActorId: metricsId, Event: obj})
			IngestHandlerRequests(domain, "success", "").Inc()
		}
	}()
	defer func() {
		if rerr := recover(); rerr != nil {
			rError = r.ResponseError(c, http.StatusOK, "panic", true, fmt.Errorf("%v", rerr), true, true, false)
		}
	}()
	// disable cache
	c.Header("Cache-Control", "no-cache, no-store, must-revalidate")
	c.Header("Pragma", "no-cache")
	c.Header("Expires", "0")
	c.Set(appbase.ContextLoggerName, "ingest")
	tp := c.Param("tp")
	message, err := r.parsePixelEvent(c, tp)
	if err != nil {
		rError = r.ResponseError(c, http.StatusOK, "error parsing message", false, err, true, true, false)
		return
	}
	messageId = message.GetS("messageId")
	if messageId == "" {
		messageId = uuid.New()
	} else {
		messageId = utils.ShortenString(messageIdUnsupportedChars.ReplaceAllString(messageId, "_"), 64)
	}
	c.Set(appbase.ContextMessageId, messageId)
	//func() string { wk, _ := message["writeKey"].(string); return wk }
	loc, err := r.getDataLocator(c, ingestType, nil)
	if err != nil {
		rError = r.ResponseError(c, http.StatusOK, "error processing message", false, err, true, true, false)
		return
	}

	domain = utils.DefaultString(loc.Slug, loc.Domain)
	metricsId = domain
	c.Set(appbase.ContextDomain, domain)

	stream := r.getStream(&loc, false, false)
	if stream == nil {
		rError = r.ResponseError(c, http.StatusOK, "stream not found", false, fmt.Errorf("for: %s", loc.String()), true, true, true)
		return
	}

	metricsId = stream.Stream.Id
	//}
	_, ingestMessageBytes, err = r.buildIngestMessage(c, messageId, message, nil, tp, loc, stream, patchEvent, "")
	if err != nil {
		rError = r.ResponseError(c, http.StatusOK, "event error", false, err, true, true, false)
		return
	}
	if len(stream.AsynchronousDestinations) == 0 {
		rError = r.ResponseError(c, http.StatusOK, ErrNoDst, false, fmt.Errorf("%s", stream.Stream.Id), true, true, true)
		return
	}
	asyncDestinations, _, rError = r.sendToRotor(c, messageId, ingestMessageBytes, stream, true)
	if rError != nil {
		return
	}
	redirectUrl := r.extractRedirectUrl(c, message)
	if redirectUrl != "" {
		c.Redirect(http.StatusFound, redirectUrl)
	} else {
		c.Data(http.StatusOK, "image/gif", appbase.EmptyGif)
	}

}

func (r *Router) extractRedirectUrl(c *gin.Context, message types.Json) string {
	redirectUrl := c.DefaultQuery(redirectUrlField, message.GetS(redirectUrlField))
	if redirectUrl != "" {
		// parse url
		parsedUrl, err := url.Parse(redirectUrl)
		if err != nil {
			r.Errorf("Error parsing redirect url %q: %v", redirectUrl, err)
			return ""
		}
		if parsedUrl.Port() != "" {
			r.Errorf("Redirect url %q must use default port", redirectUrl)
			return ""
		}
		if parsedUrl.Scheme != "https" {
			r.Errorf("Redirect url %q must use https scheme", redirectUrl)
			return ""
		}
		if parsedUrl.Host == c.Request.Host {
			r.Errorf("Redirect url %q is not allowed to redirect to the same host", redirectUrl)
			return ""
		}
		ipAddr := net.ParseIP(parsedUrl.Hostname())
		if ipAddr != nil {
			r.Errorf("Redirect url %q must not be an IP address", redirectUrl)
			return ""
		}
		return redirectUrl
	}
	return ""
}

// parseEvent parses event from query parameters (dataField and json paths)
func (r *Router) parsePixelEvent(c *gin.Context, tp string) (event types.Json, err error) {
	parameters := c.Request.URL.Query()
	event = types.NewJson(0)

	data := parameters.Get(dataField)
	if data != "" {
		dataBytes, err := base64.StdEncoding.DecodeString(data)
		if err != nil {
			return nil, fmt.Errorf("Error decoding event from %q field in tracking pixel: %v", dataField, err)
		}

		err = jsonorder.Unmarshal(dataBytes, &event)
		if err != nil {
			return nil, fmt.Errorf("Error unmarshalling event from %q: %v", dataField, err)
		}
	}

	for key, value := range parameters {
		if key == dataField || key == cookieDomainField || key == processHeaders || key == redirectUrlField {
			continue
		}
		if len(value) == 1 {
			event.SetPath(key, value[0])
		} else {
			event.SetPath(key, value)
		}
	}
	processHeadersFlag := parameters.Get(processHeaders)
	if utils.IsTruish(processHeadersFlag) {
		processHeadersData(c, event, tp)
	}
	return event, nil
}

func processHeadersData(c *gin.Context, event types.Json, tp string) {
	anonymousId := event.GetS("anonymousId")
	if anonymousId == "" {
		var err error
		anonymousId, err = c.Cookie(anonymousIdCookie)
		if errors.Is(err, http.ErrNoCookie) {
			anonymousId = uuid.New()
			topLevelDomain := event.GetS(cookieDomainField)
			if topLevelDomain == "" {
				topLevelDomain, _ = ExtractTopLevelAndDomain(c.Request.Host)
			}
			http.SetCookie(c.Writer, &http.Cookie{
				Name:     anonymousIdCookie,
				Value:    url.QueryEscape(anonymousId),
				Expires:  timestamp.Now().AddDate(1000, 12, 31),
				Path:     "/",
				Domain:   fmt.Sprint(topLevelDomain),
				SameSite: http.SameSiteNoneMode,
				Secure:   true,
				HttpOnly: false,
			})
		}
		event.Set("anonymousId", anonymousId)
	}
	userId := event.GetS("userId")
	if userId == "" {
		userId, _ = c.Cookie(userIdCookie)
		if userId != "" {
			event.Set("userId", userId)
		}
	}
	var ctx types.Json
	o, ok := event.Get("context")
	if ok {
		ctx, _ = o.(types.Json)
	}
	if ctx == nil {
		ctx = types.NewJson(0)
	}
	groupId := ctx.GetS("groupId")
	if groupId == "" {
		groupId, _ = c.Cookie(groupIdCookie)
		if groupId != "" {
			ctx.Set("groupId", groupId)
		}
	}
	var traits types.Json
	o, ok = ctx.Get("traits")
	if ok {
		traits, _ = o.(types.Json)
	}
	if traits == nil {
		traits = types.NewJson(0)
	}
	traitsNew := types.NewJson(0)
	groupTraits, _ := c.Cookie(groupTraitsCookie)
	if groupTraits != "" {
		_ = jsonorder.Unmarshal([]byte(groupTraits), &traitsNew)
	}
	userTraits, _ := c.Cookie(userTraitsCookie)
	if userTraits != "" {
		_ = jsonorder.Unmarshal([]byte(userTraits), &traitsNew)
	}
	traitsNew.SetAll(traits)
	traits = traitsNew
	if traits.Len() > 0 {
		ctx.Set("traits", traits)
	}

	referer := c.Request.Referer()
	if referer != "" {
		r, err := url.Parse(referer)
		if err == nil {
			var page types.Json
			o, ok = ctx.Get("page")
			if ok {
				page, _ = o.(types.Json)
			}
			if page == nil {
				page = types.NewJson(0)
			}
			page.SetIfAbsent("url", referer)
			page.SetIfAbsent("path", r.Path)
			page.SetIfAbsent("search", r.RawQuery)
			page.SetIfAbsent("host", r.Host)
			if page.Len() > 0 {
				ctx.Set("page", page)
			}
			if tp == "page" || tp == "p" {
				var properties types.Json
				o, ok = ctx.Get("properties")
				if ok {
					properties, _ = o.(types.Json)
				}
				if properties == nil {
					properties = types.NewJson(0)
				}
				properties.SetIfAbsent("url", referer)
				properties.SetIfAbsent("path", r.Path)
				properties.SetIfAbsent("search", r.RawQuery)
				event.Set("properties", properties)
			}
		}
	}
	event.Set("context", ctx)
}

// ExtractTopLevelAndDomain returns top level domain and domain
// e.g. abc.efg.com returns "efg.com", "abc"
func ExtractTopLevelAndDomain(adr string) (string, string) {
	var icann, topLevelDomain, domain string

	for i := 0; i < 3; i++ {
		if adr == "" {
			break
		}

		adr = strings.TrimSuffix(adr, ".")
		publicSuffix, isIcann := publicsuffix.PublicSuffix(adr)
		if isIcann && topLevelDomain == "" {
			icann = publicSuffix
		} else if topLevelDomain == "" {
			topLevelDomain = publicSuffix
		} else {
			domain = publicSuffix
		}

		adr = strings.TrimSuffix(adr, publicSuffix)
	}

	if icann != "" {
		topLevelDomain += "." + icann
	}

	return topLevelDomain, domain
}
