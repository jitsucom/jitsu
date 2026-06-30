package main

import (
	"bytes"
	"crypto/sha512"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"math/rand"
	"net"
	"net/http"
	"net/http/pprof"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/confluentinc/confluent-kafka-go/v2/kafka"
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/bulker/eventslog"
	"github.com/jitsucom/bulker/jitsubase/appbase"
	"github.com/jitsucom/bulker/jitsubase/jsoniter"
	"github.com/jitsucom/bulker/jitsubase/jsonorder"
	"github.com/jitsucom/bulker/jitsubase/logging"
	"github.com/jitsucom/bulker/jitsubase/timestamp"
	"github.com/jitsucom/bulker/jitsubase/types"
	"github.com/jitsucom/bulker/jitsubase/utils"
	"github.com/jitsucom/bulker/jitsubase/uuid"
	"github.com/jitsucom/bulker/kafkabase"
	"github.com/penglongli/gin-metrics/ginmetrics"
)

var eventTypesDict = map[string]string{
	"p": "page",
	"i": "identify",
	"t": "track",
	"g": "group",
	"a": "alias",
	"s": "screen",
	"e": "event"}

var eventTypesSet = types.NewSet("page", "identify", "track", "group", "alias", "screen")

var messageIdUnsupportedChars = regexp.MustCompile(`[^a-zA-Z0-9._-]`)

type eventPatchFunc func(c *gin.Context, messageId string, event types.Json, tp string, ingestType IngestType, analyticContext types.Json, defaultEventName string) error

type Router struct {
	*appbase.Router
	config            *Config
	kafkaConfig       *kafka.ConfigMap
	repository        appbase.Repository[Streams]
	scriptRepository  appbase.Repository[Script]
	producer          *kafkabase.Producer
	eventsLogService  eventslog.EventsLogService
	backupsLogger     *BackupLogger
	httpClient        *http.Client
	dataHosts         []string
	partitionSelector kafkabase.PartitionSelector
}

type IngestType string

const (
	IngestTypeS2S     IngestType = "s2s"
	IngestTypeBrowser IngestType = "browser"
	// type of writeKey defines the type of ingest
	IngestTypeWriteKeyDefined IngestType = "writeKey"

	ConnectionIdsHeader = "connection_ids"

	ErrNoDst                = "no destinations found for stream"
	ErrThrottledType        = "quota exceeded"
	ErrThrottledDescription = "billing quota exceeded, event throttled"
)

type StreamCredentials struct {
	Slug       string     `json:"slug"`
	Domain     string     `json:"domain"`
	WriteKey   string     `json:"writeKey"`
	IngestType IngestType `json:"ingestType"`
}

func (sc *StreamCredentials) String() string {
	return fmt.Sprintf("[slug: %s][domain: %s][writeKey: %s][ingestType: %s]", sc.Slug, sc.Domain, sc.WriteKey, sc.IngestType)
}

func NewRouter(appContext *Context, partitionSelector kafkabase.PartitionSelector) *Router {
	base := appbase.NewRouterBase(appContext.config.Config, []string{
		"/health",
		"/ready",
		"/robots.txt",
		"/p.js",
		"/v1/projects/:writeKey/settings",
		"/v1/projects/projects/:writeKey/settings",
		"/v1/projects",
		"/v1/b",
		"/v1/batch",
		"/v1/batch/b",
		"/projects/:writeKey/settings",
		"/projects/projects/:writeKey/settings",
		"/projects",
		"/b",
		"/batch",
		"/batch/b",
		"/api/s/s2s/batch",
		"/api/s/:tp",
		"/api/px/:tp",
		"/api/s/s2s/:tp",
		"/api/funcs/:conId",
		// classic compat
		"/s/lib.js",
		"/api/v1/s2s/event",
		"/api/v1/s2s/event/",
		"/api/v1/s2s/events",
		"/api/v1/event",
		"/api/v1/events",
		"/api.:ignored",
	})

	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.MaxIdleConnsPerHost = 500
	transport.MaxIdleConns = 1000

	httpClient := &http.Client{
		Timeout:   time.Duration(int64(float64(appContext.config.DeviceFunctionsTimeoutMs)*1.1)) * time.Millisecond,
		Transport: transport,
	}

	var dataHosts []string
	if appContext.config.DataDomain != "" {
		dataHosts = strings.Split(appContext.config.DataDomain, ",")
	} else if appContext.config.PublicURL != "" {
		u, err := url.ParseRequestURI(appContext.config.PublicURL)
		if err != nil {
			base.Errorf("Failed to parse PUBLIC_URL: %v", err)
		} else {
			dataHosts = []string{u.Hostname()}
		}
	}
	base.Infof("Data hosts: %s", dataHosts)

	router := &Router{
		Router:            base,
		config:            appContext.config,
		kafkaConfig:       appContext.kafkaConfig,
		producer:          appContext.producer,
		eventsLogService:  appContext.eventsLogService,
		backupsLogger:     appContext.backupsLogger,
		repository:        appContext.repository,
		scriptRepository:  appContext.scriptRepository,
		httpClient:        httpClient,
		dataHosts:         dataHosts,
		partitionSelector: partitionSelector,
	}
	engine := router.Engine()
	// get global Monitor object
	m := ginmetrics.GetMonitor()
	m.SetSlowTime(1)
	// set request duration, default {0.1, 0.3, 1.2, 5, 10}
	// used to p95, p99
	m.SetDuration([]float64{0.02, 0.05, 0.1, 0.2, 0.5})
	m.UseWithoutExposingEndpoint(engine)
	fast := engine.Group("")
	//fast.Use(timeout.Timeout(timeout.WithTimeout(5 * time.Second)))
	fast.Use(router.CorsMiddleware)
	fast.Match([]string{"GET", "OPTIONS", "POST"}, "/v1/projects/:writeKey/settings", router.SettingsHandler)
	fast.Match([]string{"GET", "OPTIONS", "POST"}, "/v1/projects/projects/:writeKey/settings", router.SettingsHandler)
	fast.Match([]string{"GET", "OPTIONS", "POST"}, "/v1/projects", router.SettingsHandler)
	fast.Match([]string{"GET", "OPTIONS", "POST"}, "/projects/:writeKey/settings", router.SettingsHandler)
	fast.Match([]string{"GET", "OPTIONS", "POST"}, "/projects/projects/:writeKey/settings", router.SettingsHandler)
	fast.Match([]string{"GET", "OPTIONS", "POST"}, "/projects", router.SettingsHandler)
	fast.Match([]string{"OPTIONS", "POST"}, "/v1/batch/b", router.BatchHandler)
	fast.Match([]string{"OPTIONS", "POST"}, "/v1/batch", router.BatchHandler)
	fast.Match([]string{"OPTIONS", "POST"}, "/v1/b", router.BatchHandler)
	fast.Match([]string{"OPTIONS", "POST"}, "/batch/b", router.BatchHandler)
	fast.Match([]string{"OPTIONS", "POST"}, "/batch", router.BatchHandler)
	fast.Match([]string{"OPTIONS", "POST"}, "/b", router.BatchHandler)
	fast.Match([]string{"OPTIONS", "POST"}, "/api/s/s2s/batch", router.BatchHandler)

	fast.Match([]string{"OPTIONS", "POST"}, "/api/s/:tp", router.IngestHandler)
	fast.Match([]string{"OPTIONS", "GET"}, "/api/px/:tp", router.PixelHandler)
	fast.Match([]string{"OPTIONS", "POST"}, "/api/s/s2s/:tp", router.IngestHandler)
	fast.Match([]string{"OPTIONS", "POST"}, "/api/funcs/:conId", router.FuncsHandler)

	// classic compat
	fast.Match([]string{"GET", "HEAD", "OPTIONS"}, "/s/lib.js", router.ClassicScriptHandler)
	fast.Match([]string{"OPTIONS", "POST"}, "/api/v1/s2s/event", router.ClassicHandler)
	fast.Match([]string{"OPTIONS", "POST"}, "/api/v1/s2s/event/", router.ClassicHandler)
	fast.Match([]string{"OPTIONS", "POST"}, "/api/v1/s2s/events", router.ClassicHandler)
	fast.Match([]string{"OPTIONS", "POST"}, "/api/v1/event", router.ClassicHandler)
	fast.Match([]string{"OPTIONS", "POST"}, "/api/v1/events", router.ClassicHandler)
	fast.Match([]string{"OPTIONS", "POST"}, "/api.:ignored", router.ClassicHandler)

	fast.Match([]string{"GET", "HEAD", "OPTIONS"}, "/p.js", router.ScriptHandler)

	engine.GET("/health", router.Health)
	engine.GET("/ready", router.Ready)
	engine.GET("/robots.txt", func(c *gin.Context) {
		c.Data(http.StatusOK, "text/plain", []byte("User-agent: *\nDisallow: /\n"))
	})

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

func (r *Router) CorsMiddleware(c *gin.Context) {
	origin := c.GetHeader("Origin")
	if c.Request.Method == "OPTIONS" {
		c.Header("Access-Control-Allow-Origin", utils.NvlString(origin, "*"))
		c.Header("Access-Control-Allow-Methods", "GET,POST,HEAD,OPTIONS")
		// x-jitsu-custom - in case client want to add some custom payload via header
		c.Header("Access-Control-Allow-Headers", "x-enable-debug, x-write-key, authorization, content-type, x-ip-policy, cache-control, x-jitsu-custom")
		c.Header("Access-Control-Allow-Credentials", "true")
		c.Header("Access-Control-Max-Age", "86400")
		c.AbortWithStatus(http.StatusOK)
		return
	} else if origin != "" {
		c.Header("Access-Control-Allow-Origin", origin)
		c.Header("Access-Control-Allow-Methods", "GET,POST,HEAD,OPTIONS")
		// x-jitsu-custom - in case client want to add some custom payload via header
		c.Header("Access-Control-Allow-Headers", "x-enable-debug, x-write-key, authorization, content-type, x-ip-policy, cache-control, x-jitsu-custom")
		c.Header("Access-Control-Allow-Credentials", "true")
		c.Header("Access-Control-Max-Age", "86400")
	}
	c.Next()
}

func (r *Router) Health(c *gin.Context) {
	if r.kafkaConfig == nil {
		logging.Errorf("Health check: FAILED: kafka config is missing")
		c.JSON(http.StatusServiceUnavailable, gin.H{"status": "fail", "output": "kafka config is missing"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "pass"})
	return
}

func (r *Router) Ready(c *gin.Context) {
	if r.kafkaConfig == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"status": "fail", "output": "kafka config is missing"})
		return
	}
	scriptOrigin := r.config.ScriptOrigin
	if scriptOrigin != "" {
		req, err := http.NewRequest("GET", scriptOrigin, nil)
		if err != nil {
			logging.Errorf("Ready check: failed to create request to %s: %v", scriptOrigin, err)
			c.JSON(http.StatusServiceUnavailable, gin.H{"status": "fail", "output": fmt.Sprintf("failed to create request to script origin: %v", err)})
			return
		}
		client := &http.Client{Timeout: 1 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			logging.Errorf("Ready check: failed to fetch script origin %s: %v", scriptOrigin, err)
			c.JSON(http.StatusServiceUnavailable, gin.H{"status": "fail", "output": fmt.Sprintf("failed to fetch script origin: %v", err)})
			return
		}
		resp.Body.Close()
		if resp.StatusCode >= 400 {
			logging.Errorf("Ready check: script origin %s returned status %d", scriptOrigin, resp.StatusCode)
			c.JSON(http.StatusServiceUnavailable, gin.H{"status": "fail", "output": fmt.Sprintf("script origin returned status %d", resp.StatusCode)})
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"status": "pass"})
}

type BatchPayload struct {
	Batch      []types.Json `json:"batch"`
	EventsName string       `json:"eventsName"`
	Context    types.Json   `json:"context"`
	WriteKey   string       `json:"writeKey"`
	// SentAt is the device-side timestamp of when the batch was sent (Segment
	// compatibility). When present it is used to correct per-event timestamps
	// for clock skew between the client device and the ingest server.
	SentAt string `json:"sentAt"`
}

func (r *Router) sendToRotor(c *gin.Context, messageId string, ingestMessageBytes []byte, stream *StreamWithDestinations, sendResponse bool) (asyncDestinations []string, tagsDestinations []string, rError *appbase.RouterError) {
	var err error
	if stream.BackupEnabled {
		backupTopic := fmt.Sprintf("%sin.id.%s_backup.m.batch.t.backup", r.config.KafkaTopicPrefix, stream.Stream.WorkspaceId)
		err2 := r.producer.ProduceAsync(backupTopic, uuid.New(), ingestMessageBytes, nil, kafka.PartitionAny, messageId, false, 0)
		if err2 != nil {
			r.Errorf("Error producing to backup topic %s: %v", backupTopic, err2)
		}
	}

	if stream.Throttle > 0 {
		if stream.Throttle >= 100 || rand.Int31n(100) < int32(stream.Throttle) {
			rError = r.ResponseError(c, http.StatusPaymentRequired, ErrThrottledType, false, fmt.Errorf(ErrThrottledDescription), sendResponse, false, true)
			return
		}
	}

	asyncDestinations = utils.ArrayMap(stream.AsynchronousDestinations, func(d *ShortDestinationConfig) string { return d.ConnectionId })
	tagsDestinations = utils.ArrayMap(stream.SynchronousDestinations, func(d *ShortDestinationConfig) string { return d.ConnectionId })

	if len(asyncDestinations) > 0 {
		topic := r.config.KafkaDestinationsTopicName
		partition := kafka.PartitionAny
		if stream.Shard > 0 {
			topic = fmt.Sprintf("%s-shard%d", topic, stream.Shard)
		} else {
			partition = r.partitionSelector.SelectPartition()
		}
		messageKey := uuid.New()
		err = r.producer.ProduceAsync(topic, messageKey, ingestMessageBytes, map[string]string{ConnectionIdsHeader: strings.Join(asyncDestinations, ",")}, partition, messageId, true, 0)
		if err != nil {
			for _, id := range asyncDestinations {
				IngestedMessages(id, "error", "producer error").Inc()
			}
			rError = r.ResponseError(c, http.StatusInternalServerError, "producer error", true, err, sendResponse, true, false)
		}
		for _, id := range asyncDestinations {
			IngestedMessages(id, "success", "").Inc()
		}
	}
	return
}

func patchEvent(c *gin.Context, messageId string, ev types.Json, tp string, ingestType IngestType, analyticContext types.Json, defaultEventName string) error {
	typeFixed := utils.MapNVL(eventTypesDict, tp, tp)
	if typeFixed == "event" {
		if defaultEventName != "" {
			typeFixed = "track"
		} else {
			typeFixed = ev.GetS("type")
			if typeFixed == "" {
				return fmt.Errorf("type property of event is required")
			}
		}
	}
	if !eventTypesSet.Contains(typeFixed) {
		return fmt.Errorf("Unknown event type: %s", typeFixed)
	}
	if typeFixed == "track" {
		//check event name
		eventName := utils.DefaultString(ev.GetS("event"), defaultEventName)
		if eventName == "" {
			return fmt.Errorf("'event' property is required for 'track' event")
		}
		//if strings.Contains(eventName, "--") || strings.Contains(eventName, ";") || strings.Contains(eventName, "=") || strings.Contains(eventName, "/*") {
		//	return fmt.Errorf("Invalid track event name '%s'. Only alpha-numeric characters, underscores and spaces are allowed in track event name.", eventName)
		//}
		if len(eventName) > 128 {
			return fmt.Errorf("Invalid track event name '%s'. Max length is 128 characters.", eventName)
		}
		if defaultEventName != "" {
			ev.SetIfAbsent("event", eventName)
		}
	}
	ip := strings.TrimSpace(strings.Split(utils.NvlString(c.GetHeader("X-Real-Ip"), c.GetHeader("X-Forwarded-For"), c.ClientIP()), ",")[0])
	ipPolicy := c.GetHeader("X-IP-Policy")
	switch ipPolicy {
	case "stripLastOctet":
		ip = ipStripLastOctet(ip)
	case "remove":
		ip = ""
	}
	if ip != "" {
		ev.Set("requestIp", ip)
	}

	ctx, ok := ev.GetN("context").(types.Json)
	if !ok || ctx == nil {
		ctx = jsonorder.NewOrderedMap[string, any](4)
		ev.Set("context", ctx)
	}

	if analyticContext != nil && analyticContext.Len() > 0 {
		mergedCtx := analyticContext.Copy()
		mergedCtx.SetAll(ctx)
		ctx = mergedCtx
		ev.Set("context", ctx)
	}
	if ingestType == IngestTypeBrowser {
		//if ip comes from browser, don't trust it!
		if ip != "" {
			ctx.Set("ip", ip)
		}
		ctx.SetIfAbsentFunc("userAgent", func() any {
			return c.GetHeader("User-Agent")
		})
		ctx.SetIfAbsentFunc("locale", func() any {
			return strings.TrimSpace(strings.Split(c.GetHeader("Accept-Language"), ",")[0])
		})
		// remove any jitsu special properties from ingested events
		// it is only allowed to be set via functions
		types.FilterEvent(ev)
	}
	nowIsoDate := time.Now().UTC().Format(timestamp.JsonISO)
	ev.Set("receivedAt", nowIsoDate)
	ev.Set("type", typeFixed)
	ev.SetIfAbsent("timestamp", nowIsoDate)
	ev.SetIfAbsent("messageId", messageId)
	return nil
}

func (r *Router) getDataLocator(c *gin.Context, ingestType IngestType, writeKeyExtractor func() string) (cred StreamCredentials, err error) {
	cred.IngestType = ingestType
	if w := c.GetHeader("Authorization"); w != "" {
		if strings.HasPrefix(w, "Bearer ") {
			cred.WriteKey = strings.TrimPrefix(w, "Bearer ")
		} else {
			wk := strings.TrimPrefix(w, "Basic ")
			//decode base64
			wkDecoded, err := base64.StdEncoding.DecodeString(wk)
			if err != nil {
				return cred, fmt.Errorf("failed to decode writeKey from Authorization header as base64: %v", err)
			}
			//remove trailing :
			wkDecoded = bytes.TrimSuffix(wkDecoded, []byte(":"))
			cred.WriteKey = string(wkDecoded)
		}
	} else if w := c.GetHeader("X-Write-Key"); w != "" {
		cred.WriteKey = w
	} else if w := c.Query("writekey"); w != "" {
		cred.WriteKey = w
	} else if writeKeyExtractor != nil {
		cred.WriteKey = writeKeyExtractor()
	}
	host := strings.Split(c.Request.Host, ":")[0]
	for _, dataHost := range r.dataHosts {
		if dataHost != "" && strings.HasSuffix(host, "."+dataHost) {
			cred.Slug = strings.TrimSuffix(host, "."+dataHost)
			return
		}
	}
	cred.Domain = host

	return
}
func isInternalHeader(headerName string) bool {
	l := strings.ToLower(headerName)
	return strings.HasPrefix(l, "x-jitsu-") || strings.HasPrefix(l, "x-vercel")
}

func ipStripLastOctet(ip string) string {
	parts := strings.Split(ip, ".")
	if len(parts) == 4 {
		return strings.Join(parts[:3], ".") + ".0"
	}
	return ip
}

// getFunctionsClasses extracts functionsClasses from destination options
func getFunctionsClasses(options map[string]any, defaultClass string) []string {
	if options == nil {
		return []string{defaultClass}
	}
	classes, ok := options["functionsClasses"].([]any)
	if !ok || len(classes) == 0 {
		return []string{defaultClass}
	}
	result := make([]string, 0, len(classes))
	for _, c := range classes {
		if s, ok := c.(string); ok && (s == "premium" || s == "dedicated" || s == "free") {
			result = append(result, s)
		}
	}
	if len(result) == 0 {
		return []string{defaultClass}
	}
	return result
}

type SyncDestinationsResponse struct {
	Destinations []*SyncDestinationsData `json:"destinations,omitempty"`
	OK           bool                    `json:"ok"`
}
type SyncDestinationsData struct {
	*ShortDestinationConfig `json:",inline,omitempty"`
	NewEvents               any `json:"newEvents,omitempty"`
	DeviceOptions           any `json:"deviceOptions,omitempty"`
}

func (r *Router) processSyncDestination(message *IngestMessage, stream *StreamWithDestinations, messageBytes []byte) *SyncDestinationsResponse {
	if len(stream.SynchronousDestinations) == 0 {
		return nil
	}
	filteredDestinations := utils.ArrayFilter(stream.SynchronousDestinations, func(d *ShortDestinationConfig) bool {
		return ApplyFilters(message.HttpPayload, d.Options)
	})
	if len(filteredDestinations) == 0 {
		return nil
	}
	var functionsResults map[string]any

	// Group destinations by functionsServer status
	// "functions" → route to functions server using deploymentId
	// "empty" → skip functions, pass through
	// "missing" or no functionsServer → drop
	type fsInfo struct {
		DeploymentID string `json:"deploymentId"`
		Status       string `json:"status"`
	}
	// Group function destinations by deploymentId for batching
	byDeployment := make(map[string][]*ShortDestinationConfig)
	for _, d := range filteredDestinations {
		fs, _ := d.Options["functionsServer"].(map[string]any)
		if fs == nil {
			r.SystemErrorf("No functionsServer info for connection %s", d.ConnectionId)
			continue // no functionsServer info — skip
		}
		switch fs["status"] {
		case "functions":
			deploymentID, _ := fs["deploymentId"].(string)
			if deploymentID != "" {
				byDeployment[deploymentID] = append(byDeployment[deploymentID], d)
			}
		case "empty":
		default:
			r.Errorf("functionsServer status for connection %s: %v", d.ConnectionId, fs["status"])
		}
	}

	if len(byDeployment) > 0 {
		functionsResults = make(map[string]any)

		for deploymentID, destinations := range byDeployment {
			fsURL := strings.Replace(r.config.FunctionsServerURLTemplate, "${workspaceId}", deploymentID, 1)
			endpointURL := fsURL + "/multi"
			r.callFunctionsEndpoint(stream, destinations, endpointURL, messageBytes, functionsResults, false, message.MessageId, parseReceivedAt(message.MessageCreated))
		}
	}

	data := make([]*SyncDestinationsData, 0, len(filteredDestinations))
	for _, d := range filteredDestinations {
		fs, _ := d.Options["functionsServer"].(map[string]any)
		status := ""
		if fs != nil {
			status, _ = fs["status"].(string)
		}
		// Skip "missing" destinations
		if status == "missing" || status == "" {
			continue
		}
		IngestedMessages(d.ConnectionId, "success", "").Inc()
		dOptions := DeviceOptions[d.DestinationType]
		newEvents, ok := functionsResults[d.ConnectionId].([]any)
		if ok {
			if len(newEvents) > 0 {
				data = append(data, &SyncDestinationsData{ShortDestinationConfig: d.CloneForJsLib(), NewEvents: newEvents, DeviceOptions: dOptions})
			}
		} else {
			data = append(data, &SyncDestinationsData{ShortDestinationConfig: d.CloneForJsLib(), DeviceOptions: dOptions})
		}
	}
	return &SyncDestinationsResponse{Destinations: data, OK: true}
}

// FunctionExecLogEntry represents a single function execution log entry
type FunctionExecLogEntry struct {
	EventIndex int    `json:"eventIndex"`
	FunctionId string `json:"functionId"`
	Error      *struct {
		Name    string `json:"name"`
		Message string `json:"message"`
	} `json:"error,omitempty"`
	Dropped bool    `json:"dropped,omitempty"`
	Ms      float64 `json:"ms"`
}

// FunctionLogEntry represents a console log entry from function execution
type FunctionLogEntry struct {
	Level        string `json:"level"`
	FunctionId   string `json:"functionId"`
	FunctionType string `json:"functionType,omitempty"`
	Message      any    `json:"message"`
	Args         []any  `json:"args,omitempty"`
	Timestamp    string `json:"timestamp,omitempty"`
}

// ConnectionChainResult is the new response format from functions endpoint (with execLog)
type ConnectionChainResult struct {
	Events  []any                  `json:"events"`
	ExecLog []FunctionExecLogEntry `json:"execLog"`
	Logs    []FunctionLogEntry     `json:"logs,omitempty"`
}

// callFunctionsEndpoint sends a request to functions endpoint and expects new format with execLog
// Response format: map[connectionId]{ events: [], execLog: [] }
func (r *Router) callFunctionsEndpoint(stream *StreamWithDestinations, destinations []*ShortDestinationConfig, baseURL string, messageBytes []byte, functionsResults map[string]any, fullEvents bool, messageId string, receivedAt time.Time) (result map[string]ConnectionChainResult, err error) {
	if len(destinations) == 0 {
		return
	}

	ids := utils.ArrayMap(destinations, func(d *ShortDestinationConfig) string { return d.ConnectionId })
	defer func() {
		if err != nil {
			obj := map[string]any{"error": err.Error()}
			for _, id := range ids {
				r.eventsLogService.PostAsync(&eventslog.ActorEvent{
					EventType: eventslog.EventTypeFunction,
					Level:     eventslog.LevelError,
					ActorId:   id,
					Event:     obj,
				})
				DeviceFunctions(id, "error").Inc()
				DeviceFunctions("total", "error").Inc()
			}
		} else {
			for _, id := range ids {
				DeviceFunctions(id, "success").Inc()
				DeviceFunctions("total", "success").Inc()
			}
		}
	}()

	url := baseURL + "?ids=" + strings.Join(ids, ",")
	if fullEvents {
		url += "&fullEvents=true"
	}
	req, err := http.NewRequest("POST", url, bytes.NewReader(messageBytes))
	if err != nil {
		r.Errorf("failed to create functions request for connections: %s: %v", ids, err)
		err = fmt.Errorf("functions server internal error. Please contact support")
		return
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Request-Timeout-Ms", strconv.Itoa(int(0.9*float64(r.config.DeviceFunctionsTimeoutMs))))
	if r.config.RotorAuthKey != "" {
		req.Header.Set("Authorization", "Bearer "+r.config.RotorAuthKey)
	}

	res, err := r.httpClient.Do(req)
	if err != nil {
		r.Errorf("failed to send functions request for connections: %s: %v", ids, err)
		var netErr net.Error
		if errors.As(err, &netErr) && netErr.Timeout() {
			err = fmt.Errorf("functions server timeout after %dms", r.config.DeviceFunctionsTimeoutMs)
		} else {
			err = fmt.Errorf("functions server internal error. Please contact support")
		}
		return
	}
	defer res.Body.Close()

	body, err := io.ReadAll(res.Body)
	if res.StatusCode != 200 || err != nil {
		r.Errorf("Failed to send functions request for connections: %s: status: %v body: %s", ids, res.StatusCode, string(body))
		err = fmt.Errorf("functions server error code: %d", res.StatusCode)
		return
	}
	err = jsoniter.Unmarshal(body, &result)
	if err != nil {
		r.Errorf("Failed to unmarshal functions response for connections: %s: %v", ids, err)
		err = fmt.Errorf("functions server internal error. Please contact support")
		return
	}

	// Process results - extract events and process execLog + logs
	for connectionId, chainResult := range result {
		functionsResults[connectionId] = chainResult.Events
		r.processExecLog(connectionId, chainResult.ExecLog, chainResult.Logs)
	}
	r.emitSyncMetrics(stream, destinations, result, messageId, receivedAt)
	return result, nil
}

// processExecLog processes the execution log and function logs from functions server
func (r *Router) processExecLog(connectionId string, execLog []FunctionExecLogEntry, logs []FunctionLogEntry) {
	// Process execution log entries (errors and dropped events)
	for _, el := range execLog {
		if el.Error != nil {
			//r.Warnf("[%s] Function %s error: %s: %s", connectionId, el.FunctionId, el.Error.Name, el.Error.Message)
			DeviceFunctions(connectionId, "function_error").Inc()
			// Log to eventsLogService similar to how rotor sends to clickhouse logger
			logEvent := map[string]any{
				"functionId":   el.FunctionId,
				"functionType": "udf",
				"eventIndex":   el.EventIndex,
				"error":        fmt.Sprintf("%s: %s", el.Error.Name, el.Error.Message),
				"ms":           el.Ms,
			}
			r.eventsLogService.PostAsync(&eventslog.ActorEvent{
				EventType: eventslog.EventTypeFunction,
				Level:     eventslog.LevelError,
				ActorId:   connectionId,
				Event:     logEvent,
			})
		}
		if el.Dropped {
			DeviceFunctions(connectionId, "dropped").Inc()
		}
	}

	// Process function console logs
	for _, logEntry := range logs {
		level := eventslog.LevelInfo
		switch logEntry.Level {
		case "error":
			level = eventslog.LevelError
		case "warn":
			level = eventslog.LevelWarning
		case "debug":
			level = eventslog.LevelDebug
		}
		var logEvent map[string]any
		if httpEvent, ok := logEntry.Message.(map[string]any); ok {
			logEvent = httpEvent
		} else {
			logEvent = map[string]any{
				"functionId": logEntry.FunctionId,
				"type":       "log-" + logEntry.Level,
				"message": map[string]any{
					"text": logEntry.Message,
					"args": logEntry.Args,
				},
			}
		}
		if logEntry.FunctionType != "" {
			logEvent["functionType"] = logEntry.FunctionType
		}
		if len(logEntry.Args) > 0 {
			logEvent["args"] = logEntry.Args
		}
		r.eventsLogService.PostAsync(&eventslog.ActorEvent{
			EventType: eventslog.EventTypeFunction,
			Level:     level,
			ActorId:   connectionId,
			Event:     logEvent,
		})
	}
}

// connMetricMessage is one row of the `metrics` table (connection metrics →
// mv_metrics → console reports). Field names map directly to the ClickHouse columns.
type connMetricMessage struct {
	Timestamp     string `json:"timestamp"`
	MessageId     string `json:"messageId"`
	WorkspaceId   string `json:"workspaceId"`
	StreamId      string `json:"streamId"`
	ConnectionId  string `json:"connectionId"`
	FunctionId    string `json:"functionId"`
	DestinationId string `json:"destinationId"`
	Status        string `json:"status"`
	Events        int64  `json:"events"`
	EventIndex    int    `json:"eventIndex"`
}

// activeIncomingMessage is one row of the `active_incoming` table (billing). The
// MessageId carries the composed key `messageId_eventIndex_secondOfHour`, deduplicated
// downstream via uniqState(messageId).
type activeIncomingMessage struct {
	Timestamp   string `json:"timestamp"`
	WorkspaceId string `json:"workspaceId"`
	MessageId   string `json:"messageId"`
}

// parseReceivedAt parses an event receivedAt/MessageCreated ISO string, falling back to
// the current time when it is missing or unparseable.
func parseReceivedAt(s string) time.Time {
	if s != "" {
		if t, err := timestamp.ParseISOFormat(s); err == nil {
			return t.UTC()
		}
	}
	return timestamp.Now().UTC()
}

// emitSyncMetrics produces billing (active_incoming) and connection (metrics) metrics for
// events processed by the synchronous function-server paths (/api/funcs/:conId and
// processSyncDestination). In the async pipeline these are emitted downstream — bulkerapp
// consumers call SendMetrics after warehouse delivery (connection metrics) and rotor writes
// billing — but the sync paths have no such post-delivery hook, so without this the events
// are invisible to both billing and the console connection reports.
//
// Produced to the same Kafka batch topics as SendMetrics, owned by the special "metrics"
// bulker destination and consumed into ClickHouse by bulkerapp. The ingest service has no
// Destination repository, so the topic ids are built directly; "metrics"/"active_incoming"
// are valid topic names, so this matches MakeTopicId's plain ".t." form (see
// bulkerapp/app/topic_manager.go). Same single-JSON-object-per-row shape and plain status
// vocabulary (success/error/dropped) as SendMetrics.
//
//   - metrics:         one row per (connection, event); status rolled up from the chain
//     result (error > dropped > success).
//   - active_incoming: one row per (workspace, messageId, eventIndex) for non-dropped
//     events, keyed identically to the async path so uniqState(messageId) de-duplicates —
//     no double counting when processSyncDestination's parent already billed the incoming
//     event via sendToRotor for an async destination.
func (r *Router) emitSyncMetrics(stream *StreamWithDestinations, destinations []*ShortDestinationConfig, result map[string]ConnectionChainResult, messageId string, receivedAt time.Time) {
	if r.config.MetricsDestinationId == "" || len(result) == 0 {
		return
	}
	metricsTopic := fmt.Sprintf("%sin.id.%s.m.batch.t.metrics", r.config.KafkaTopicPrefix, r.config.MetricsDestinationId)
	billingTopic := fmt.Sprintf("%sin.id.%s.m.batch.t.active_incoming", r.config.KafkaTopicPrefix, r.config.MetricsDestinationId)

	connMsgs, billingMsgs := buildSyncMetrics(stream.Stream.WorkspaceId, stream.Stream.Id, destinations, result, messageId, receivedAt)
	for i := range connMsgs {
		if cm, err := jsoniter.Marshal(&connMsgs[i]); err == nil {
			if perr := r.producer.ProduceAsync(metricsTopic, uuid.New(), cm, nil, kafka.PartitionAny, messageId, false, 0); perr != nil {
				r.Errorf("Error producing connection metrics to %s: %v", metricsTopic, perr)
			}
		}
	}
	for i := range billingMsgs {
		if bm, err := jsoniter.Marshal(&billingMsgs[i]); err == nil {
			if perr := r.producer.ProduceAsync(billingTopic, billingMsgs[i].MessageId, bm, nil, kafka.PartitionAny, messageId, false, 0); perr != nil {
				r.Errorf("Error producing billing metrics to %s: %v", billingTopic, perr)
			}
		}
	}
}

// buildSyncMetrics turns the per-connection chain results into the `metrics` and
// `active_incoming` rows to emit. It is a pure function (no I/O) so it can be unit tested.
//
//   - One connMetricMessage per (connection, eventIndex); status is rolled up from the
//     per-function exec log with precedence error > dropped > success.
//   - One activeIncomingMessage per non-dropped (connection, eventIndex). The composed key
//     `messageId_eventIndex_secondOfHour` matches the async path exactly, so
//     uniqState(messageId) downstream de-duplicates across paths and destinations.
func buildSyncMetrics(workspaceId, streamId string, destinations []*ShortDestinationConfig, result map[string]ConnectionChainResult, messageId string, receivedAt time.Time) ([]connMetricMessage, []activeIncomingMessage) {
	destById := make(map[string]*ShortDestinationConfig, len(destinations))
	for _, d := range destinations {
		destById[d.ConnectionId] = d
	}
	epoch := receivedAt.Unix()
	hourTrunc := epoch - epoch%3600
	tsISO := timestamp.ToISOFormat(receivedAt.UTC())
	hourISO := timestamp.ToISOFormat(time.Unix(hourTrunc, 0).UTC())

	var connMsgs []connMetricMessage
	var billingMsgs []activeIncomingMessage
	for connectionId, chainResult := range result {
		destinationId := connectionId
		functionId := "builtin.destination.tag"
		if d := destById[connectionId]; d != nil {
			destinationId = d.Id
			functionId = "builtin.destination." + d.DestinationType
		}

		// Roll the per-function exec log up to a single status per event index.
		statuses := make(map[int]string)
		order := make([]int, 0)
		for _, el := range chainResult.ExecLog {
			cur, seen := statuses[el.EventIndex]
			if !seen {
				order = append(order, el.EventIndex)
				cur = "success"
			}
			// "dropped" is the terminal disposition — the event did not reach delivery —
			// so it overrides "error" (an event that errored *and* was dropped never
			// delivered and must not be billed). "error" overrides "success".
			switch {
			case el.Dropped:
				cur = "dropped"
			case el.Error != nil && cur != "dropped":
				cur = "error"
			}
			statuses[el.EventIndex] = cur
		}
		// Empty exec log (e.g. no functions ran) — still count the incoming event once.
		if len(order) == 0 {
			order = append(order, 0)
			statuses[0] = "success"
		}

		for _, eventIndex := range order {
			status := statuses[eventIndex]
			connMsgs = append(connMsgs, connMetricMessage{
				Timestamp:     tsISO,
				MessageId:     messageId,
				WorkspaceId:   workspaceId,
				StreamId:      streamId,
				ConnectionId:  connectionId,
				FunctionId:    functionId,
				DestinationId: destinationId,
				Status:        status,
				Events:        1,
				EventIndex:    eventIndex,
			})
			// Billing counts active incoming events: everything whose terminal
			// disposition is not "dropped". A pure error (delivered but failed) is billed,
			// mirroring the async rule, which bills builtin.destination.* entries that are
			// non-dropped (a destination that errors keeps status "error" and is billed).
			// An event that was dropped — including one dropped as the result of an error —
			// never reached delivery and is not billed.
			if status == "dropped" {
				continue
			}
			billingMsgs = append(billingMsgs, activeIncomingMessage{
				Timestamp:   hourISO,
				WorkspaceId: workspaceId,
				MessageId:   fmt.Sprintf("%s_%d_%d", messageId, eventIndex, epoch-hourTrunc),
			})
		}
	}
	return connMsgs, billingMsgs
}

func (r *Router) buildIngestMessage(c *gin.Context, messageId string, event types.Json, analyticContext types.Json, tp string, loc StreamCredentials, stream *StreamWithDestinations, patchFunc eventPatchFunc, defaultEventName string) (ingestMessage *IngestMessage, ingestMessageBytes []byte, err error) {
	err = patchFunc(c, messageId, event, tp, loc.IngestType, analyticContext, defaultEventName)
	headers := utils.MapMap(utils.MapFilter(c.Request.Header, func(k string, v []string) bool {
		return len(v) > 0 && !isInternalHeader(k)
	}), func(k string, v []string) string {
		if strings.ToLower(k) == "x-write-key" {
			return maskWriteKey(v[0])
		}
		return strings.Join(v, ",")
	})
	bodyType := utils.Ternary(tp != "classic", event.GetS("type"), event.GetS("event_type"))
	ingestMessage = &IngestMessage{
		IngestType:     loc.IngestType,
		MessageCreated: utils.Ternary(tp != "classic", event.GetS("receivedAt"), event.GetS("_timestamp")),
		MessageId:      messageId,
		WriteKey:       maskWriteKey(loc.WriteKey),
		Type:           utils.NvlString(bodyType, tp),
		Origin: IngestMessageOrigin{
			BaseURL:     fmt.Sprintf("%s://%s", c.Request.URL.Scheme, c.Request.URL.Host),
			Slug:        loc.Slug,
			WorkspaceId: stream.Stream.WorkspaceId,
			SourceId:    stream.Stream.Id,
			SourceName:  stream.Stream.Name,
			Domain:      loc.Domain,
		},
		HttpHeaders: headers,
		HttpPayload: event,
	}
	if tp == "classic" {
		ingestMessage.Origin.Classic = true
	}
	ingestMessageBytes, err1 := jsonorder.Marshal(ingestMessage)
	if err1 != nil {
		err = utils.Nvl(err, err1)
	} else {
		if len(ingestMessageBytes) > r.config.MaxIngestPayloadSize {
			err = fmt.Errorf("message size %d is too big. max allowed: %d", len(ingestMessageBytes), r.config.MaxIngestPayloadSize)
		}
	}
	return
}

func hashApiKey(token string, salt string, secret string) string {
	hash := sha512.New()
	hash.Write([]byte(token + salt + secret))
	res := hash.Sum(nil)
	return fmt.Sprintf("%x", res)
}

func (r *Router) checkHash(hash string, secret string) bool {
	pk := strings.SplitN(hash, ".", 2)
	if len(pk) < 2 {
		r.Errorf("invalid hash format: %s", hash)
		return false
	}
	salt := pk[0]
	hashPart := pk[1]
	for _, globalSecret := range r.config.GlobalHashSecrets {
		if hashPart == hashApiKey(secret, salt, globalSecret) {
			return true
		}
	}
	return false
}

type IngestMessageOrigin struct {
	BaseURL     string `json:"baseUrl,omitempty"`
	Slug        string `json:"slug,omitempty"`
	WorkspaceId string `json:"workspaceId,omitempty"`
	SourceId    string `json:"sourceId,omitempty"`
	SourceName  string `json:"sourceName,omitempty"`
	Domain      string `json:"domain,omitempty"`
	Classic     bool   `json:"classic,omitempty"`
}

type IngestMessage struct {
	IngestType     IngestType          `json:"ingestType"`
	MessageCreated string              `json:"messageCreated"`
	WriteKey       string              `json:"writeKey,omitempty"`
	MessageId      string              `json:"messageId"`
	Type           string              `json:"type"`
	Origin         IngestMessageOrigin `json:"origin"`
	HttpHeaders    map[string]string   `json:"httpHeaders"`
	HttpPayload    types.Json          `json:"httpPayload"`
}

type StreamLocator func(loc *StreamCredentials, s2sEndpoint bool) *StreamWithDestinations

func (r *Router) getStream(loc *StreamCredentials, strict, s2sEndpoint bool) *StreamWithDestinations {
	var locators []StreamLocator
	if strict {
		locators = []StreamLocator{r.WriteKeyStreamLocator}
	} else if loc.IngestType == IngestTypeWriteKeyDefined {
		locators = []StreamLocator{r.WriteKeyStreamLocator, r.SlugStreamLocator, r.AmbiguousDomainStreamLocator, r.SoleStreamLocator}
	} else if loc.IngestType == IngestTypeS2S {
		locators = []StreamLocator{r.WriteKeyStreamLocator, r.SlugStreamLocator, r.AmbiguousDomainStreamLocator}
	} else {
		locators = []StreamLocator{r.SlugStreamLocator, r.DomainStreamLocator, r.WriteKeyStreamLocator, r.SoleStreamLocator}
	}
	for _, locator := range locators {
		stream := locator(loc, s2sEndpoint)
		if stream != nil {
			return stream
		}
	}
	return nil
}

func (r *Router) checkOrigin(c *gin.Context, loc *StreamCredentials, stream *StreamWithDestinations) error {
	if loc.IngestType == IngestTypeBrowser {
		domainsString := strings.TrimSpace(stream.Stream.AuthorizedJavaScriptDomains)
		if domainsString != "" && domainsString != "*" {
			originString := c.GetHeader("Origin")
			if originString == "" {
				return nil
			}
			origin, trimmed := strings.CutPrefix(originString, "https://")
			if !trimmed {
				origin = strings.TrimPrefix(originString, "http://")
			}
			origin = strings.Split(origin, ":")[0]
			if !ApplyAuthorizedJavaScriptDomainsFilter(domainsString, origin) {
				return fmt.Errorf("Stream: %s Workspace: %s Origin %s is not authorized by: %s", stream.Stream.Id, stream.Stream.WorkspaceId, origin, domainsString)
			}
		}
	}
	return nil
}

func (r *Router) WriteKeyStreamLocator(loc *StreamCredentials, s2sEndpoint bool) *StreamWithDestinations {
	if loc.WriteKey != "" {
		parts := strings.Split(loc.WriteKey, ":")
		if len(parts) == 1 {
			loc.IngestType = utils.Ternary(s2sEndpoint, IngestTypeS2S, IngestTypeBrowser)
			if s2sEndpoint {
				return r.repository.GetData().GetS2SStreamByPlainKeyOrId(loc.WriteKey)
			} else {
				return r.repository.GetData().GetStreamByPlainKeyOrId(loc.WriteKey)
			}
		} else {
			binding := r.repository.GetData().getStreamByKeyId(parts[0])
			if binding != nil {
				if loc.IngestType != IngestTypeWriteKeyDefined && binding.KeyType != string(loc.IngestType) {
					r.Debugf("[stream: %s]%s invalid key type found %s", binding.StreamId, loc.String(), binding.KeyType)
				} else if !r.checkHash(binding.Hash, parts[1]) {
					r.Debugf("[stream: %s]%s invalid key secret", binding.StreamId, loc.String())
				} else {
					stream := r.repository.GetData().GetStreamByPlainKeyOrId(binding.StreamId)
					if stream != nil {
						loc.IngestType = IngestType(binding.KeyType)
						return stream
					}
				}
			}
		}
	}
	return nil
}

func (r *Router) SlugStreamLocator(loc *StreamCredentials, s2sEndpoint bool) *StreamWithDestinations {
	if loc.Slug != "" {
		stream := r.repository.GetData().GetStreamByPlainKeyOrId(loc.Slug)
		if stream != nil && !stream.Stream.Strict {
			loc.IngestType = utils.Ternary(s2sEndpoint, IngestTypeS2S, IngestTypeBrowser)
			return stream
		}
	}
	return nil
}

func (r *Router) DomainStreamLocator(loc *StreamCredentials, s2sEndpoint bool) *StreamWithDestinations {
	if loc.Domain != "" {
		streams := r.repository.GetData().GetStreamsByDomain(loc.Domain)
		if len(streams) == 1 {
			stream := streams[0]
			if !stream.Stream.Strict {
				loc.IngestType = utils.Ternary(s2sEndpoint, IngestTypeS2S, IngestTypeBrowser)
				return stream
			}
		} else if loc.WriteKey == "" && len(streams) > 1 {
			for _, stream := range streams {
				if !stream.Stream.Strict {
					loc.IngestType = utils.Ternary(s2sEndpoint, IngestTypeS2S, IngestTypeBrowser)
					return stream
				}
			}
		}
	}
	return nil
}

func (r *Router) AmbiguousDomainStreamLocator(loc *StreamCredentials, s2sEndpoint bool) *StreamWithDestinations {
	if loc.Domain != "" {
		streams := r.repository.GetData().GetStreamsByDomain(loc.Domain)
		if len(streams) > 0 {
			for _, stream := range streams {
				if !stream.Stream.Strict {
					loc.IngestType = utils.Ternary(s2sEndpoint, IngestTypeS2S, IngestTypeBrowser)
					return stream
				}
			}
		}
	}
	return nil
}

func (r *Router) SoleStreamLocator(loc *StreamCredentials, s2sEndpoint bool) *StreamWithDestinations {
	streams := r.repository.GetData().GetStreams()
	if len(streams) == 1 {
		stream := streams[0]
		if !stream.Stream.Strict {
			loc.IngestType = utils.Ternary(s2sEndpoint, IngestTypeS2S, IngestTypeBrowser)
			return stream
		}
	}
	return nil
}

func maskWriteKey(writeKey string) string {
	if writeKey != "" {
		parts := strings.Split(writeKey, ":")
		if len(parts) > 1 {
			return parts[0] + ":***"
		} else {
			return writeKey[0:1] + "***" + writeKey[len(writeKey)-1:]
		}
	}
	return writeKey
}
