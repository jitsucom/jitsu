package main

import (
	"compress/gzip"
	"fmt"
	"math"
	"net/http"
	"strings"
	"time"

	kafka2 "github.com/confluentinc/confluent-kafka-go/v2/kafka"
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/bulker/eventslog"
	"github.com/jitsucom/bulker/jitsubase/appbase"
	"github.com/jitsucom/bulker/jitsubase/jsonorder"
	"github.com/jitsucom/bulker/jitsubase/timestamp"
	"github.com/jitsucom/bulker/jitsubase/types"
	"github.com/jitsucom/bulker/jitsubase/utils"
	"github.com/jitsucom/bulker/jitsubase/uuid"
)

// significantClockSkew is the minimum |receivedAt - sentAt| below which we
// don't bother rewriting the event's timestamp. Sub-threshold skew is
// dominated by NTP drift, network jitter, and request handling latency,
// so any "correction" we'd apply is noise on noise. Above the threshold
// the device clock is materially wrong (offline queue replay, manually
// adjusted clock, wrong timezone interpretation) and adjustment is worth
// doing.
const significantClockSkew = 5 * time.Minute

// applyEventTimestampCorrection implements Segment-style clock-skew
// correction for a single event: when `sentAt` (device time) is set and
// the offset between server's receivedAt and device's sentAt exceeds
// significantClockSkew, that offset is added to the event's `timestamp`.
// `sentAt` is always propagated onto the event (regardless of threshold),
// so downstream consumers see it per-event whether it arrived on a batch
// envelope or as a per-event field.
//
// The pre-correction device timestamp is intentionally NOT preserved —
// downstream warehouses already have to deal with enough timestamp
// columns, and adding a Segment-only `originalTimestamp` here just leaks
// a field into every schema. Consumers that need the device clock can
// recover it as `timestamp - (receivedAt - sentAt)`.
//
// See https://www.twilio.com/docs/segment/connections/spec/common#sentat
func applyEventTimestampCorrection(ev types.Json, sentAt string, receivedAt time.Time) {
	if ev == nil || sentAt == "" {
		return
	}
	sentAtTime, err := time.Parse(time.RFC3339Nano, sentAt)
	if err != nil {
		return
	}
	ev.SetIfAbsent("sentAt", sentAt)
	tsStr := ev.GetS("timestamp")
	if tsStr == "" {
		return
	}
	ts, err := time.Parse(time.RFC3339Nano, tsStr)
	if err != nil {
		return
	}
	offset := receivedAt.Sub(sentAtTime)
	if offset.Abs() < significantClockSkew {
		return
	}
	ev.Set("timestamp", ts.Add(offset).UTC().Format(timestamp.JsonISO))
}

// applySegmentTimestampCorrection is a thin batch wrapper. Kept for the
// existing unit tests; production callers propagate the envelope `sentAt`
// onto each event and let patchEvent invoke the per-event helper.
func applySegmentTimestampCorrection(batch []types.Json, sentAt string, receivedAt time.Time) {
	for _, ev := range batch {
		applyEventTimestampCorrection(ev, sentAt, receivedAt)
	}
}

// eventKey represents the fields used to identify duplicate events
type eventKey struct {
	anonymousId string
	userId      string
	eventType   string
	event       string
	parameters  string // JSON-encoded parameters
	traits      string // JSON-encoded traits
}

// deduplicateBatch removes duplicate events from a batch based on the configured gap
// Duplicate events have identical: anonymousId, userId, type, event, parameters, traits
// Timestamps may differ by no more than gapMs milliseconds
func deduplicateBatch(batch []types.Json, gapMs int) []types.Json {
	if len(batch) <= 1 {
		return batch
	}

	// Map to track seen events: key -> (timestamp, index in result)
	seen := make(map[eventKey]struct {
		timestamp time.Time
		index     int
	})

	result := make([]types.Json, 0, len(batch))

	for _, event := range batch {
		// Extract event fields
		anonymousId := event.GetS("anonymousId")
		userId := event.GetS("userId")
		eventType := event.GetS("type")
		eventName := event.GetS("event")

		// Get timestamp - if missing, skip deduplication for this event
		tsStr := event.GetS("timestamp")
		if tsStr == "" {
			result = append(result, event)
			continue
		}

		// Parse timestamp
		ts, err := time.Parse(time.RFC3339Nano, tsStr)
		if err != nil {
			// Can't parse timestamp, skip deduplication for this event
			result = append(result, event)
			continue
		}

		// Extract parameters and traits as JSON strings for comparison
		var parametersStr, traitsStr string
		if params, ok := event.Get("properties"); ok {
			parametersStr = fmt.Sprint(params)
		}
		if traits, ok := event.Get("traits"); ok {
			traitsStr = fmt.Sprint(traits)
		}

		key := eventKey{
			anonymousId: anonymousId,
			userId:      userId,
			eventType:   eventType,
			event:       eventName,
			parameters:  parametersStr,
			traits:      traitsStr,
		}

		// Check if we've seen this event before
		if existing, found := seen[key]; found {
			// Calculate time difference in milliseconds
			timeDiff := math.Abs(float64(ts.Sub(existing.timestamp).Milliseconds()))

			// If within the gap, this is a duplicate - skip it
			if timeDiff <= float64(gapMs) {
				continue
			}
		}

		// Not a duplicate, add to result
		seen[key] = struct {
			timestamp time.Time
			index     int
		}{timestamp: ts, index: len(result)}
		result = append(result, event)
	}

	return result
}

func (r *Router) BatchHandler(c *gin.Context) {
	var rError *appbase.RouterError
	var payload BatchPayload
	domain := "BATCH"
	metricsId := "UNKNOWN"
	metricsBatchSize := 1
	var s2sEndpoint bool

	defer func() {
		IngestedMessagesReceived(metricsId, "received").Add(float64(metricsBatchSize))
		if rError != nil {
			IngestHandlerRequests(domain, "error", rError.ErrorType).Inc()
			IngestedMessagesReceived(metricsId, "errors").Add(float64(metricsBatchSize))
		}
	}()
	defer func() {
		if rerr := recover(); rerr != nil {
			rError = r.ResponseError(c, http.StatusInternalServerError, "panic", true, fmt.Errorf("%v", rerr), true, true, false)
		}
	}()
	c.Set(appbase.ContextLoggerName, "batch")
	if !strings.HasSuffix(c.ContentType(), "application/json") && !strings.HasSuffix(c.ContentType(), "text/plain") {
		rError = r.ResponseError(c, http.StatusBadRequest, "invalid content type", false, fmt.Errorf("%s. Expected: application/json", c.ContentType()), true, true, false)
		return
	}
	bodyReader := c.Request.Body
	var err error
	if strings.Contains(c.GetHeader("Content-Encoding"), "gzip") {
		bodyReader, err = gzip.NewReader(bodyReader)
	}
	if err == nil {
		err = jsonorder.NewDecoder(bodyReader).Decode(&payload)
	}
	if err != nil {
		err = fmt.Errorf("Client Ip: %s: %v", utils.NvlString(c.GetHeader("X-Real-Ip"), c.GetHeader("X-Forwarded-For"), c.ClientIP()), err)
		rError = r.ResponseError(c, http.StatusBadRequest, "error parsing message", false, err, true, true, false)
		return
	}
	metricsBatchSize = len(payload.Batch)
	if c.FullPath() == "/api/s/s2s/batch" {
		// may still be overridden by write key type
		s2sEndpoint = true
	}
	loc, err := r.getDataLocator(c, IngestTypeWriteKeyDefined, func() string { return payload.WriteKey })
	if err != nil {
		rError = r.ResponseError(c, http.StatusBadRequest, "error processing message", false, err, true, true, false)
		return
	}
	domain = utils.DefaultString(loc.Slug, loc.Domain)
	metricsId = domain
	c.Set(appbase.ContextDomain, domain)

	stream := r.getStream(&loc, true, s2sEndpoint)
	if stream == nil {
		rError = r.ResponseError(c, http.StatusUnauthorized, "stream not found", false, fmt.Errorf("for: %s", loc.String()), true, true, true)
		return
	}
	s2sEndpoint = s2sEndpoint || loc.IngestType == IngestTypeS2S

	metricsId = stream.Stream.Id
	//if err = r.checkOrigin(c, &loc, stream); err != nil {
	//	r.Warnf("[batch] %v", err)
	//}

	// Segment compatibility: a batch may carry a root-level `sentAt` that
	// applies to every event in the payload. Propagate it onto each event
	// (only when the event doesn't already carry its own) so the per-event
	// clock-skew correction inside patchEvent has a uniform input. The
	// correction itself — and the matching `receivedAt` stamp — happens
	// per-event in patchEvent, which keeps offset and receivedAt computed
	// from the same time.Now() and avoids drift across the batch loop.
	batch := payload.Batch
	if payload.SentAt != "" {
		for _, ev := range batch {
			if ev != nil {
				ev.SetIfAbsent("sentAt", payload.SentAt)
			}
		}
	}

	// Apply in-batch deduplication if any destination has deduplication enabled
	deduplicated := 0
	if stream.Stream.DeduplicateWindowMs > 0 {
		originalSize := len(batch)
		batch = deduplicateBatch(batch, stream.Stream.DeduplicateWindowMs)
		deduplicated = originalSize - len(batch)
	}

	okEvents := 0
	errors := make([]string, 0)
	for _, event := range batch {
		messageId := event.GetS("messageId")
		if messageId == "" {
			messageId = uuid.New()
		} else {
			messageId = utils.ShortenString(messageIdUnsupportedChars.ReplaceAllString(messageId, "_"), 64)
		}
		c.Set(appbase.ContextMessageId, messageId)
		_, ingestMessageBytes, err1 := r.buildIngestMessage(c, messageId, event, payload.Context, "event", loc, stream, patchEvent, payload.EventsName)
		var asyncDestinations, tagsDestinations []string
		if err1 == nil {
			if len(stream.AsynchronousDestinations) == 0 {
				rError = r.ResponseError(c, http.StatusOK, ErrNoDst, false, fmt.Errorf("%s", stream.Stream.Id), false, true, true)
			} else {
				asyncDestinations, tagsDestinations, rError = r.sendToRotor(c, messageId, ingestMessageBytes, stream, false)
			}
		} else {
			rError = r.ResponseError(c, http.StatusOK, "event error", false, err1, false, true, false)
		}
		if len(ingestMessageBytes) >= 0 {
			_ = r.backupsLogger.Log(utils.DefaultString(metricsId, "UNKNOWN"), ingestMessageBytes)
		}
		if rError != nil && rError.ErrorType != ErrNoDst {
			obj := map[string]any{"body": string(ingestMessageBytes), "error": rError.PublicError.Error(), "status": utils.Ternary(rError.ErrorType == ErrThrottledType, "SKIPPED", "FAILED")}
			r.eventsLogService.PostAsync(&eventslog.ActorEvent{EventType: eventslog.EventTypeIncoming, Level: eventslog.LevelError, ActorId: metricsId, Event: obj})
			IngestHandlerRequests(domain, utils.Ternary(rError.ErrorType == ErrThrottledType, "throttled", "error"), rError.ErrorType).Inc()
			_ = r.producer.ProduceAsync(r.config.KafkaDestinationsDeadLetterTopicName, uuid.New(), utils.TruncateBytes(ingestMessageBytes, r.config.MaxIngestPayloadSize), map[string]string{"error": rError.Error.Error()}, kafka2.PartitionAny, messageId, false)
			errors = append(errors, fmt.Sprintf("Message ID: %s: %v", messageId, rError.PublicError))
		} else {
			obj := map[string]any{"body": string(ingestMessageBytes), "asyncDestinations": asyncDestinations, "tags": tagsDestinations}
			if len(asyncDestinations) > 0 || len(tagsDestinations) > 0 {
				okEvents++
				obj["status"] = "SUCCESS"
			} else {
				obj["status"] = "SKIPPED"
				obj["error"] = ErrNoDst
				errors = append(errors, fmt.Sprintf("Message ID: %s: %v", messageId, rError.PublicError))
			}
			r.eventsLogService.PostAsync(&eventslog.ActorEvent{EventType: eventslog.EventTypeIncoming, Level: eventslog.LevelInfo, ActorId: metricsId, Event: obj})
			IngestHandlerRequests(domain, "success", "").Inc()
		}
	}
	processedEvents := len(batch)
	response := gin.H{
		"ok":             processedEvents == okEvents,
		"receivedEvents": metricsBatchSize,
		"okEvents":       okEvents,
	}

	// Include deduplication info if deduplication occurred
	if deduplicated > 0 {
		IngestedMessagesReceived(metricsId, "deduplicated").Add(float64(deduplicated))
		response["deduplicatedEvents"] = deduplicated
		response["processedEvents"] = processedEvents
	}

	if len(errors) > 0 {
		IngestedMessagesReceived(metricsId, "errors").Add(float64(len(errors)))
		response["ok"] = false
		response["errors"] = errors
	}

	c.JSON(http.StatusOK, response)
}
