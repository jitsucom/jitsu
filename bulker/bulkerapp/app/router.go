package app

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/pprof"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/jitsucom/bulker/jitsubase/logging"
	"github.com/jitsucom/bulker/kafkabase"

	"github.com/confluentinc/confluent-kafka-go/v2/kafka"
	"github.com/gin-gonic/gin"
	"github.com/hjson/hjson-go/v4"
	"github.com/jitsucom/bulker/bulkerapp/metrics"
	bulker "github.com/jitsucom/bulker/bulkerlib"
	"github.com/jitsucom/bulker/bulkerlib/types"
	"github.com/jitsucom/bulker/eventslog"
	"github.com/jitsucom/bulker/jitsubase/appbase"
	"github.com/jitsucom/bulker/jitsubase/jsoniter"
	"github.com/jitsucom/bulker/jitsubase/jsonorder"
	"github.com/jitsucom/bulker/jitsubase/timestamp"
	"github.com/jitsucom/bulker/jitsubase/utils"
	"github.com/jitsucom/bulker/jitsubase/uuid"
)

var TimestampPattern = regexp.MustCompile(`^\d{13}$`)
var WriteKeyPattern = regexp.MustCompile(`"writeKey":\s*"([^:"]+)?(:)?([^"]+)?"`)

type Router struct {
	*appbase.Router
	config           *Config
	kafkaConfig      *kafka.ConfigMap
	repository       *Repository
	topicManager     *TopicManager
	producer         *Producer
	eventsLogService eventslog.EventsLogService
	fastStore        *FastStore
}

func NewRouter(appContext *Context) *Router {
	base := appbase.NewRouterBase(appContext.config.Config, []string{"/ready", "/health"})

	router := &Router{
		Router:           base,
		config:           appContext.config,
		kafkaConfig:      appContext.kafkaConfig,
		repository:       appContext.repository,
		topicManager:     appContext.topicManager,
		producer:         appContext.batchProducer,
		eventsLogService: appContext.eventsLogService,
		fastStore:        appContext.fastStore,
	}
	engine := router.Engine()
	fast := engine.Group("")
	//fast.Use(timeout.Timeout(timeout.WithTimeout(10 * time.Second)))
	fast.POST("/post/:destinationId", router.EventsHandler)
	fast.POST("/profiles/:profileBuilderId/:priority", router.ProfilesHandler)
	fast.POST("/test", router.TestConnectionHandler)
	fast.GET("/log/:eventType/:actorId", router.EventsLogHandler)
	fast.GET("/ready", router.Health)
	fast.GET("/health", router.Health)

	engine.POST("/bulk/:destinationId", router.BulkHandler)
	engine.GET("/failed/:destinationId", router.FailedHandler)

	engine.GET("/connections-metrics/:workspaceId", router.ConnectionsMetricsHandler)

	engine.GET("/debug/pprof/profile", gin.WrapF(pprof.Profile))
	engine.GET("/debug/pprof/heap", gin.WrapF(pprof.Handler("heap").ServeHTTP))
	engine.GET("/debug/pprof/goroutine", gin.WrapF(pprof.Handler("goroutine").ServeHTTP))
	engine.GET("/debug/pprof/block", gin.WrapF(pprof.Handler("block").ServeHTTP))
	engine.GET("/debug/pprof/threadcreate", gin.WrapF(pprof.Handler("threadcreate").ServeHTTP))
	engine.GET("/debug/pprof/cmdline", gin.WrapF(pprof.Handler("cmdline").ServeHTTP))
	engine.GET("/debug/pprof/symbol", gin.WrapF(pprof.Handler("symbol").ServeHTTP))
	engine.GET("/debug/pprof/trace", gin.WrapF(pprof.Handler("trace").ServeHTTP))
	engine.GET("/debug/pprof/mutex", gin.WrapF(pprof.Handler("mutex").ServeHTTP))
	engine.GET("/debug/pprof", gin.WrapF(pprof.Index))

	return router
}

func (r *Router) Health(c *gin.Context) {
	if r.kafkaConfig == nil {
		c.JSON(http.StatusOK, gin.H{"status": "pass"})
		return
	}
	updatedAt := r.topicManager.UpdatedAt()
	if r.config.EnableConsumers {
		if !r.topicManager.IsReady() {
			logging.Errorf("Health check: FAILED: topic manager is not ready")
			c.JSON(http.StatusServiceUnavailable, gin.H{"status": "fail", "output": "topic manager is not ready"})
			return
		}
		if updatedAt.IsZero() || time.Since(updatedAt) > time.Duration(10*r.config.TopicManagerRefreshPeriodSec)*time.Second {
			logging.Errorf("Health check: FAILED: topic manager is outdated: %s", updatedAt)
			c.JSON(http.StatusServiceUnavailable, gin.H{"status": "fail", "output": "topic manager is outdated: " + updatedAt.String()})
			return
		}
	}
	size, err := r.producer.QueueSize()
	if err != nil {
		logging.Errorf("Health check: FAILED: producer queue size error: %v", err)
		c.JSON(http.StatusServiceUnavailable, gin.H{"status": "fail", "output": "producer queue size error: " + err.Error()})
		return
	}
	if size >= r.config.ProducerQueueSize {
		logging.Errorf("Health check: FAILED: producer queue full: %d/%d", size, r.config.ProducerQueueSize)
		c.JSON(http.StatusServiceUnavailable, gin.H{"status": "fail", "output": fmt.Sprintf("producer queue full: %d/%d", size, r.config.ProducerQueueSize)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "pass", "producerQueueSize": size, "topicsUpdatedAt": updatedAt})
	return
}

func (r *Router) EventsHandler(c *gin.Context) {
	destinationId := c.Param("destinationId")
	tableName := c.Query("tableName")
	partitionStr := c.Query("partition")
	modeOverride := c.Query("modeOverride")
	metricsMeta := utils.NvlString(c.GetHeader("metricsMeta"), c.Query("metricsMeta"))
	streamOptions := utils.NvlString(c.GetHeader("streamOptions"), c.Query("streamOptions"))
	mode := ""
	bytesRead := 0
	partition := 0
	if partitionStr != "" {
		partition, _ = strconv.Atoi(partitionStr)
	}
	var rError *appbase.RouterError
	defer func() {
		if rError != nil {
			metrics.EventsHandlerRequests(destinationId, mode, tableName, "error", rError.ErrorType).Inc()
		} else {
			metrics.EventsHandlerRequests(destinationId, mode, tableName, "success", "").Inc()
			metrics.EventsHandlerBytes(destinationId, mode, tableName, "success", "").Add(float64(bytesRead))
		}
	}()

	destination := r.repository.GetDestination(destinationId)
	if destination == nil {
		rError = r.ResponseError(c, http.StatusNotFound, "destination not found", false, fmt.Errorf("destination not found: %s", destinationId), true, true, false)
		return
	}
	mode = utils.NvlString(modeOverride, string(destination.Mode()), string(bulker.Batch))
	if mode != string(bulker.Batch) && mode != string(bulker.Stream) {
		rError = r.ResponseError(c, http.StatusBadRequest, "invalid bulker mode", false, fmt.Errorf("invalid bulker mode: %s", mode), true, true, false)
		return
	}
	if tableName == "" {
		rError = r.ResponseError(c, http.StatusBadRequest, "missing required parameter", false, fmt.Errorf("tableName query parameter is required"), true, true, false)
		return
	}
	topicId, err := destination.TopicId(tableName, mode, r.config.KafkaTopicPrefix, partition)
	if err != nil {
		rError = r.ResponseError(c, http.StatusInternalServerError, "couldn't generate topicId", false, err, true, true, false)
		return
	}
	err = r.topicManager.EnsureDestinationTopic(topicId)
	if err != nil {
		kafkaErr, ok := err.(kafka.Error)
		if ok && kafkaErr.Code() == kafka.ErrTopicAlreadyExists {
			r.Warnf("Topic %s already exists", topicId)
		} else {
			rError = r.ResponseError(c, http.StatusInternalServerError, "couldn't create topic", false, fmt.Errorf("topicId %s: %v", topicId, err), true, true, false)
			return
		}
	}

	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		rError = r.ResponseError(c, http.StatusBadRequest, "error reading HTTP body", false, err, true, true, false)
		return
	}
	bytesRead = len(body)
	headers := map[string]string{MetricsMetaHeader: metricsMeta}
	if streamOptions != "" {
		headers[streamOptionsKeyHeader] = streamOptions
	}
	err = r.producer.ProduceAsync(topicId, uuid.New(), body, headers, kafka.PartitionAny, "", false, 5*time.Second)
	if err != nil {
		rError = r.ResponseError(c, http.StatusInternalServerError, "producer error", true, err, true, true, false)
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "ok"})
}

func (r *Router) ProfilesHandler(c *gin.Context) {
	profileBuilderId := c.Param("profileBuilderId")
	priority := c.Param("priority")
	profileId := c.Query("profileId")
	var rError *appbase.RouterError
	defer func() {
		if rError != nil {
			metrics.EventsHandlerRequests(profileBuilderId, profilesTopicMode, priority, "error", rError.ErrorType).Inc()
		} else {
			metrics.EventsHandlerRequests(profileBuilderId, profilesTopicMode, priority, "success", "").Inc()
		}
	}()

	topicId, err := MakeTopicId(profileBuilderId, profilesTopicMode, priority, r.config.KafkaTopicPrefix, 0, false)
	if err != nil {
		rError = r.ResponseError(c, http.StatusInternalServerError, "couldn't generate topicId", false, err, true, true, false)
		return
	}

	err = r.producer.ProduceAsync(topicId, profileId, nil, nil, kafka.PartitionAny, "", false, 5*time.Second)
	if err != nil {
		rError = r.ResponseError(c, http.StatusInternalServerError, "producer error", true, err, true, true, false)
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "ok"})
}

func (r *Router) BulkHandler(c *gin.Context) {
	start := time.Now()
	destinationId := c.Param("destinationId")
	tableName := c.Query("tableName")
	taskId := c.DefaultQuery("taskId", uuid.New())
	jobId := c.DefaultQuery("jobId", fmt.Sprintf("%s_%s_%s", destinationId, tableName, taskId))
	bulkMode := bulker.BulkMode(c.DefaultQuery("mode", string(bulker.ReplaceTable)))
	pkeys := c.QueryArray("pk")
	schemaHeader := c.GetHeader("X-Jitsu-Schema")
	mode := ""
	bytesRead := 0
	var err error
	var rError *appbase.RouterError
	var processedObjectSample types.Object
	var state bulker.State
	defer func() {
		state.ProcessingTimeSec = time.Since(start).Seconds()
		if rError != nil {
			r.postEventsLog(destinationId, state, processedObjectSample, rError.PublicError)
			metrics.BulkHandlerRequests(destinationId, mode, tableName, "error", rError.ErrorType).Inc()
		} else {
			r.postEventsLog(destinationId, state, processedObjectSample, nil)
			metrics.BulkHandlerRequests(destinationId, mode, tableName, "success", "").Inc()
			metrics.EventsHandlerBytes(destinationId, mode, tableName, "success", "").Add(float64(bytesRead))
		}
	}()

	destination := r.repository.GetDestination(destinationId)
	if destination == nil {
		rError = r.ResponseError(c, http.StatusNotFound, "destination not found", false, fmt.Errorf("destination not found: %s", destinationId), true, true, false)
		return
	}
	mode = string(destination.Mode())
	if tableName == "" {
		rError = r.ResponseError(c, http.StatusBadRequest, "missing required parameter", false, fmt.Errorf("tableName query parameter is required"), true, true, false)
		return
	}
	var streamOptions []bulker.StreamOption
	if len(pkeys) > 0 {
		streamOptions = append(streamOptions, bulker.WithPrimaryKey(pkeys...), bulker.WithDeduplicate())
	}
	if schemaHeader != "" {
		schema := types.Schema{}
		err = jsoniter.Unmarshal([]byte(schemaHeader), &schema)
		if err != nil {
			rError = r.ResponseError(c, http.StatusBadRequest, "schema unmarshal error", false, err, true, true, false)
			return
		}
		if !schema.IsEmpty() {
			streamOptions = append(streamOptions, bulker.WithSchema(schema))
		}
		r.Infof("Schema for %s: %v", jobId, schema)
	}
	//streamOptions = append(streamOptions, sql.WithoutOmitNils())
	destination.InitBulkerInstance()
	bulkerStream, err := destination.bulker.CreateStream(jobId, tableName, bulkMode, streamOptions...)
	if err != nil {
		rError = r.ResponseError(c, http.StatusInternalServerError, "create stream error", true, err, true, true, false)
		return
	}
	scanner := bufio.NewScanner(c.Request.Body)
	scanner.Buffer(make([]byte, 1024*10), 1024*1024)
	consumed := 0
	for scanner.Scan() {
		eventBytes := scanner.Bytes()
		if len(eventBytes) >= 5 && string(eventBytes[:5]) == "ABORT" {
			state = bulkerStream.Abort(c)
			rError = r.ResponseError(c, http.StatusBadRequest, "aborted", false, errors.New(string(eventBytes)), true, true, false)
			return
		}
		bytesRead += len(eventBytes)
		var obj types.Object
		if err = jsonorder.Unmarshal(eventBytes, &obj); err != nil {
			state = bulkerStream.Abort(c)
			rError = r.ResponseError(c, http.StatusBadRequest, "unmarhsal error", false, err, true, true, false)
			return
		}
		if _, processedObjectSample, err = bulkerStream.Consume(c, obj); err != nil {
			state = bulkerStream.Abort(c)
			rError = r.ResponseError(c, http.StatusBadRequest, "stream consume error", false, err, true, true, false)
			return
		}
		consumed++
	}
	if err = scanner.Err(); err != nil {
		state = bulkerStream.Abort(c)
		rError = r.ResponseError(c, http.StatusBadRequest, "scanner error", false, err, true, true, false)
		return
	}
	if consumed > 0 {
		state, err = bulkerStream.Complete(c)
		if err != nil {
			rError = r.ResponseError(c, http.StatusBadRequest, "stream complete error", false, err, true, true, false)
			return
		}
		r.Infof("Bulk stream for %s mode: %s Completed. Processed: %d in %dms.", jobId, mode, state.SuccessfulRows, time.Since(start).Milliseconds())
		c.JSON(http.StatusOK, gin.H{"message": "ok", "state": state})
	} else {
		state = bulkerStream.Abort(c)
		c.JSON(http.StatusOK, gin.H{"message": "ok"})
	}
}

func (r *Router) postEventsLog(destinationId string, state bulker.State, processedObjectSample types.Object, batchErr error) {
	if batchErr != nil && state.LastError == nil {
		state.SetError(batchErr)
	}
	batchState := BatchState{State: state, LastMappedRow: processedObjectSample}
	level := eventslog.LevelInfo
	if batchErr != nil {
		level = eventslog.LevelError
	}
	r.eventsLogService.PostAsync(&eventslog.ActorEvent{EventType: eventslog.EventTypeBatch, Level: level, ActorId: destinationId, Event: batchState})
}

func maskWriteKey(wk string) string {
	arr := strings.Split(wk, ":")
	if len(arr) > 1 {
		return arr[0] + ":***"
	} else {
		return "***"
	}
}

func (r *Router) ConnectionsMetricsHandler(c *gin.Context) {
	workspaceId := c.Param("workspaceId")
	if len(workspaceId) < 10 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid workspaceId"})
		return
	}
	query := `max (bulkerapp_consumer_queue_size{destinationId=~"` + workspaceId + `-.*"}) by (__name__, destinationId, mode, tableName) or 
sum (connection_message_statuses{destinationId=~"` + workspaceId + `-.*"}) by (__name__, destinationId, tableName, status)`
	resp, err := http.DefaultClient.Get(r.config.PrometheusURL + "/api/v1/query?query=" + url.QueryEscape(query))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to get queue sizes: " + err.Error()})
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to get queue sizes: " + resp.Status})
		return
	}
	bytes, err := io.ReadAll(resp.Body)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read response: " + err.Error()})
		return
	}
	c.Data(resp.StatusCode, "application/json", bytes)
}

func (r *Router) FailedHandler(c *gin.Context) {
	destinationId := c.Param("destinationId")
	status := c.DefaultQuery("status", "dead")
	tableName := c.DefaultQuery("tableName", allTablesToken)
	mode := c.DefaultQuery("mode", "batch")
	if status != retryTopicMode && status != deadTopicMode {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unknown status: " + status + " (should be '" + retryTopicMode + "' or '" + deadTopicMode + "')"})
		return
	}
	topicId := r.config.KafkaDestinationsDeadLetterTopicName
	if status == retryTopicMode {
		topicId, _ = MakeTopicId(destinationId, retryTopicMode, allTablesToken, r.config.KafkaTopicPrefix, 0, false)
	}
	ogTopicId, _ := MakeTopicId(destinationId, mode, tableName, r.config.KafkaTopicPrefix, 0, false)
	consumerConfig := kafka.ConfigMap(utils.MapPutAll(kafka.ConfigMap{
		"auto.offset.reset":             "earliest",
		"group.id":                      uuid.New(),
		"enable.auto.commit":            false,
		"partition.assignment.strategy": r.config.KafkaConsumerPartitionsAssigmentStrategy,
		"isolation.level":               "read_committed",
	}, *r.kafkaConfig))

	consumer, err := kafka.NewConsumer(&consumerConfig)
	if err == nil {
		err = consumer.Assign([]kafka.TopicPartition{{Topic: &topicId, Partition: 0, Offset: kafka.OffsetBeginning}})
	}
	if err != nil {
		r.ResponseError(c, http.StatusInternalServerError, "consumer error", true, err, true, true, false)
		return
	}
	start := time.Now()
	c.Header("Content-Type", "application/x-ndjson")
	for {
		msg, err := consumer.ReadMessage(time.Second * 5)
		jsn := make(map[string]any)
		if err != nil {
			kafkaErr := err.(kafka.Error)
			if kafkaErr.Code() == kafka.ErrTimedOut {
				break
			}
			errorID := uuid.NewLettersNumbers()
			err = fmt.Errorf("error# %s: couldn't read kafka message from topic: %s : %v", errorID, topicId, kafkaErr)
			r.Errorf(err.Error())
			jsn["ERROR"] = fmt.Errorf("error# %s: couldn't read kafka message", errorID).Error()
		} else {
			if kafkabase.GetKafkaHeader(msg, originalTopicHeader) != ogTopicId {
				continue
			}
			err = hjson.Unmarshal(msg.Value, &jsn)
			if err != nil {
				jsn["UNPARSABLE_MESSAGE"] = string(msg.Value)
			}
		}

		bytes, _ := jsoniter.Marshal(jsn)
		_, _ = c.Writer.Write(bytes)
		_, _ = c.Writer.Write([]byte("\n"))
		if msg.Timestamp.After(start) {
			break
		}
	}
	_ = consumer.Close()
}

func (r *Router) TestConnectionHandler(c *gin.Context) {
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		_ = r.ResponseError(c, http.StatusBadRequest, "error reading HTTP body", false, err, true, true, false)
		return
	}
	bulkerCfg := bulker.Config{}
	var destinationConfig map[string]any
	err = utils.ParseObject(body, &destinationConfig)
	if err != nil {
		_ = r.ResponseError(c, http.StatusUnprocessableEntity, "parse failed", false, err, true, true, false)
		return
	} else {
		r.Debugf("[test] parsed config for destination %s: %+v", utils.MapNVL(destinationConfig, "id", ""), destinationConfig)
	}
	bulkerCfg.DestinationConfig = destinationConfig
	bulkerCfg.Id = utils.MapNVL(destinationConfig, "id", "").(string)
	bulkerCfg.BulkerType = utils.MapNVL(destinationConfig, "destinationType", "").(string)

	b, err := bulker.CreateBulker(bulkerCfg)
	if err != nil {
		if b != nil {
			_ = b.Close()
		}
		_ = r.ResponseError(c, http.StatusUnprocessableEntity, "error creating bulker", false, err, true, true, false)
		return
	}
	_ = b.Close()
	// test with stream settings
	//
	//if bulkerCfg.StreamConfig.BulkMode != "" || len(bulkerCfg.StreamConfig.Options) > 0 {
	//	options := bulker.StreamOptions{}
	//	for name, serializedOption := range bulkerCfg.StreamConfig.Options {
	//		opt, err := bulker.ParseOption(name, serializedOption)
	//		if err != nil {
	//			_ = r.ResponseError(c, http.StatusUnprocessableEntity, "option parse error", false, err)
	//			return
	//		}
	//		options.Add(opt)
	//	}
	//	str, err := b.CreateStream(bulkerCfg.Id(), bulkerCfg.TableName, bulkerCfg.BulkMode, options.Options...)
	//	if err != nil {
	//		_ = r.ResponseError(c, http.StatusUnprocessableEntity, "error creating bulker stream", false, err)
	//		return
	//	}
	//	_, _ = str.Abort(context.Background())
	//}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// EventsLogHandler - gets events log by EventType, actor id. Filtered by date range and cursorId
func (r *Router) EventsLogHandler(c *gin.Context) {
	eventKey := c.Param("eventType")
	actorId := c.Param("actorId")
	beforeId := c.Query("beforeId")
	start := c.Query("start")
	end := c.Query("end")
	limit := c.Query("limit")
	ndjson := c.Query("ndjson")
	maxBytesStr := c.Query("maxBytes")
	maxBytes := 0
	var err error
	if maxBytesStr != "" {
		maxBytes, err = strconv.Atoi(maxBytesStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "'maxBytes' parameter must be an integer number"})
			return
		}
	}

	eventsLogFilter := &eventslog.EventsLogFilter{}
	eventsLogFilter.Start, err = parseDateQueryParam(start)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "'start' parameter must be either unix timestamp or date in '2006-01-02' format"})
		return
	}
	eventsLogFilter.End, err = parseDateQueryParam(end)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "'end' parameter must be either unix timestamp or date in '2006-01-02' format"})
		return
	}
	iLimit := 100
	if limit != "" {
		iLimit2, err := strconv.Atoi(limit)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "'limit' parameter must be an integer number"})
			return
		}
		if iLimit2 < 1000 {
			iLimit = iLimit2
		}
	}
	parts := strings.Split(eventKey, ".")
	eventType := parts[0]
	level := parts[1]
	eventsLogFilter.BeforeId = eventslog.EventsLogRecordId(beforeId)
	records, err := r.eventsLogService.GetEvents(eventslog.EventType(eventType), actorId, level, eventsLogFilter, iLimit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get events log: " + err.Error()})
		return
	}
	written := 0
	if ok, _ := strconv.ParseBool(ndjson); ok {
		c.Header("Content-Type", "application/x-ndjson")
		for _, record := range records {
			maskWriteKeyInObj(eventType, record)
			bytes, err := jsoniter.Marshal(record)
			if err != nil {
				bytes = []byte(fmt.Sprintf(`{"EVENTS_LOG_ERROR": "Failed to marshal event log record: %s", "OBJECT": "%+v"}`, err.Error(), record))
			}
			if maxBytes > 0 && written+len(bytes) > maxBytes {
				break
			}
			_, _ = c.Writer.Write(bytes)
			_, _ = c.Writer.Write([]byte("\n"))
			written += len(bytes) + 1
		}
	} else {
		c.Header("Content-Type", "application/json")
		_, _ = c.Writer.Write([]byte("["))
		for _, record := range records {
			maskWriteKeyInObj(eventType, record)
			bytes, err := jsoniter.Marshal(record)
			if err != nil {
				bytes = []byte(fmt.Sprintf(`{"EVENTS_LOG_ERROR": "Failed to marshal event log record: %s", "OBJECT": "%+v"}`, err.Error(), record))
			}
			if maxBytes > 0 && written+len(bytes) > maxBytes {
				break
			}
			if written > 0 {
				_, _ = c.Writer.Write([]byte(","))
			}
			_, _ = c.Writer.Write(bytes)
			written += len(bytes) + 1
		}
		_, _ = c.Writer.Write([]byte("]"))
	}
}

func maskWriteKeyInObj(eventType string, record eventslog.EventsLogRecord) {
	if eventType == "incoming" {
		o, ok := record.Content.(map[string]any)
		if ok {
			b, ok := o["body"].(string)
			if ok {
				o["body"] = WriteKeyPattern.ReplaceAllString(b, `"writeKey": "$1$2***"`)
			}
		}
	}
}

func parseDateQueryParam(param string) (time.Time, error) {
	if param != "" {
		if TimestampPattern.MatchString(param) {
			startTs, _ := strconv.Atoi(param)
			return time.UnixMilli(int64(startTs)), nil
		} else {
			return time.Parse(timestamp.DashDayLayout, param)
		}
	}
	return time.Time{}, nil
}
