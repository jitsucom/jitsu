package main

import (
	"fmt"
	"io"
	"net/http"
	"strings"

	kafka2 "github.com/confluentinc/confluent-kafka-go/v2/kafka"
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/bulker/eventslog"
	"github.com/jitsucom/bulker/jitsubase/appbase"
	"github.com/jitsucom/bulker/jitsubase/jsonorder"
	"github.com/jitsucom/bulker/jitsubase/types"
	"github.com/jitsucom/bulker/jitsubase/utils"
	"github.com/jitsucom/bulker/jitsubase/uuid"
)

func (r *Router) FuncsHandler(c *gin.Context) {
	conId := c.Param("conId")
	s2sEndpoint := true
	domain := ""
	metricsId := "UNKNOWN"
	var rError *appbase.RouterError
	var body []byte
	var ingestMessageBytes []byte
	var ingestMessage *IngestMessage
	ingestType := IngestTypeS2S
	var messageId string

	defer func() {
		if len(ingestMessageBytes) == 0 {
			ingestMessageBytes = body
		}
		if len(ingestMessageBytes) > 0 {
			_ = r.backupsLogger.Log(metricsId, ingestMessageBytes)
		}
		IngestedMessagesReceived(metricsId, "received").Inc()
		if rError != nil {
			IngestedMessagesReceived(metricsId, "errors").Inc()
			obj := map[string]any{"body": string(ingestMessageBytes), "error": rError.PublicError.Error(), "status": utils.Ternary(rError.ErrorType == ErrThrottledType, "SKIPPED", "FAILED")}
			r.eventsLogService.PostAsync(&eventslog.ActorEvent{EventType: eventslog.EventTypeIncoming, Level: eventslog.LevelError, ActorId: metricsId, Event: obj})
			IngestHandlerRequests(domain, utils.Ternary(rError.ErrorType == ErrThrottledType, "throttled", "error"), rError.ErrorType).Inc()
			_ = r.producer.ProduceAsync(r.config.KafkaDestinationsDeadLetterTopicName, uuid.New(), utils.TruncateBytes(ingestMessageBytes, r.config.MaxIngestPayloadSize), map[string]string{"error": rError.Error.Error()}, kafka2.PartitionAny, messageId, false, 0)
		} else {
			obj := map[string]any{"body": string(ingestMessageBytes)}
			obj["status"] = "SUCCESS"
			r.eventsLogService.PostAsync(&eventslog.ActorEvent{EventType: eventslog.EventTypeIncoming, Level: eventslog.LevelInfo, ActorId: metricsId, Event: obj})
			IngestHandlerRequests(domain, "success", "").Inc()
		}
	}()
	defer func() {
		if rerr := recover(); rerr != nil {
			rError = r.ResponseError(c, http.StatusInternalServerError, "panic", true, fmt.Errorf("%v", rerr), true, true, false)
		}
	}()
	c.Set(appbase.ContextLoggerName, "ingest")
	if !strings.HasSuffix(c.ContentType(), "application/json") && !strings.HasSuffix(c.ContentType(), "text/plain") {
		rError = r.ResponseError(c, http.StatusBadRequest, "invalid content type", false, fmt.Errorf("%s. Expected: application/json", c.ContentType()), true, true, false)
		return
	}
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		err = fmt.Errorf("Client Ip: %s: %v", utils.NvlString(c.GetHeader("X-Real-Ip"), c.GetHeader("X-Forwarded-For"), c.ClientIP()), err)
		rError = r.ResponseError(c, utils.Ternary(s2sEndpoint, http.StatusBadRequest, http.StatusOK), "error reading HTTP body", false, err, true, true, false)
		return
	}
	var message types.Json
	err = jsonorder.Unmarshal(body, &message)
	if err != nil {
		rError = r.ResponseError(c, utils.Ternary(s2sEndpoint, http.StatusBadRequest, http.StatusOK), "error parsing message", false, fmt.Errorf("%v: %s", err, string(body)), true, true, false)
		return
	}
	tp := message.GetS("type")
	messageId = message.GetS("messageId")
	if messageId == "" {
		messageId = uuid.New()
	} else {
		messageId = utils.ShortenString(messageIdUnsupportedChars.ReplaceAllString(messageId, "_"), 64)
	}
	c.Set(appbase.ContextMessageId, messageId)

	loc, err := r.getDataLocator(c, ingestType, nil)
	if err != nil {
		rError = r.ResponseError(c, utils.Ternary(s2sEndpoint, http.StatusBadRequest, http.StatusOK), "error processing message", false, fmt.Errorf("%v: %s", err, string(body)), true, true, false)
		return
	}

	domain = utils.DefaultString(loc.Slug, loc.Domain)
	metricsId = domain
	c.Set(appbase.ContextDomain, domain)

	stream := r.getStream(&loc, true, s2sEndpoint)
	if stream == nil {
		rError = r.ResponseError(c, utils.Ternary(s2sEndpoint, http.StatusUnauthorized, http.StatusOK), "stream not found", false, fmt.Errorf("for: %s", loc.String()), true, true, true)
		return
	}
	metricsId = stream.Stream.Id
	var connection *ShortDestinationConfig
	for _, con := range stream.Destinations {
		if con.ConnectionId == conId {
			connection = &con
			break
		}
	}
	if connection == nil {
		rError = r.ResponseError(c, utils.Ternary(s2sEndpoint, http.StatusUnauthorized, http.StatusOK), "connection not found", false, fmt.Errorf("for: %s", loc.String()), true, true, true)
		return
	}
	funcs, ok := connection.Options["functions"].([]any)
	if !ok || len(funcs) == 0 {
		c.Status(http.StatusNoContent)
		return
	}
	ingestMessage, ingestMessageBytes, err = r.buildIngestMessage(c, messageId, message, nil, tp, loc, stream, patchEvent, "")
	if err != nil {
		rError = r.ResponseError(c, utils.Ternary(s2sEndpoint, http.StatusBadRequest, http.StatusOK), "event error", false, err, true, true, false)
		return
	}
	functionsResults := make(map[string]any)
	// Get functions server deployment info from connection options
	fs, _ := connection.Options["functionsServer"].(map[string]any)
	deploymentID := ""
	if fs != nil {
		deploymentID, _ = fs["deploymentId"].(string)
	}
	if deploymentID == "" {
		deploymentID = stream.Stream.WorkspaceId
	}
	fsURL := strings.Replace(r.config.FunctionsServerURLTemplate, "${workspaceId}", deploymentID, 1)
	endpointURL := fsURL + "/multi"
	result, err := r.callFunctionsEndpoint(stream, []*ShortDestinationConfig{connection}, endpointURL, ingestMessageBytes, functionsResults, true, messageId, parseReceivedAt(ingestMessage.MessageCreated))
	if err != nil {
		if strings.Contains(err.Error(), "timeout") {
			IngestedMessages(connection.ConnectionId, "error", "timeout").Inc()
			rError = r.ResponseError(c, http.StatusGatewayTimeout, "functions server timeout", false, err, true, true, false)
			return
		} else {
			IngestedMessages(connection.ConnectionId, "error", "other").Inc()
			rError = r.ResponseError(c, http.StatusInternalServerError, "functions server error", false, err, true, true, false)
			return
		}
	} else {
		IngestedMessages(connection.ConnectionId, "success", "").Inc()
	}

	c.JSON(http.StatusOK, result[conId])
}
