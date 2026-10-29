package api_based

import (
	"bytes"
	"errors"
	"fmt"
	bulker "github.com/jitsucom/bulker/bulkerlib"
	types2 "github.com/jitsucom/bulker/bulkerlib/types"
	"github.com/jitsucom/bulker/jitsubase/appbase"
	"github.com/jitsucom/bulker/jitsubase/jsonorder"
	"github.com/jitsucom/bulker/jitsubase/types"
	"github.com/jitsucom/bulker/jitsubase/utils"
	"io"
	"net/http"
	"os"
	"regexp"
	"strings"
	"sync/atomic"
	"time"
)

const WebhookBulkerTypeId = "webhook"
const WebhookUnsupported = "Only 'batch' mode is supported"

// maxResponseBodyBytes caps how much of a webhook response is read.
const maxResponseBodyBytes = 64 * 1024

var GlobalIngestEndpoint = os.Getenv("GLOBAL_INGEST_ENDPOINT")
var LocalIngestEndpoint = os.Getenv("LOCAL_INGEST_ENDPOINT")

var MacrosRegex = regexp.MustCompile(`\{\{\s*([\w.-]+)\s*}}`)

func init() {
	bulker.RegisterBulker(WebhookBulkerTypeId, NewWebhookBulker)
}

type WebhookConfigPayload struct {
	Lang string `mapstructure:"lang" json:"lang" yaml:"lang"`
	Code string `mapstructure:"code" json:"code" yaml:"code"`
}
type WebhookConfig struct {
	URL           string   `mapstructure:"url" json:"url" yaml:"url"`
	Method        string   `mapstructure:"method" json:"method" yaml:"method"`
	Headers       []string `mapstructure:"headers" json:"headers" yaml:"headers"`
	CustomPayload bool     `mapstructure:"customPayload" json:"customPayload" yaml:"customPayload"`
	Payload       string   `mapstructure:"payload" json:"payload" yaml:"payload"`
}
type WebhookBulker struct {
	appbase.Service
	config      WebhookConfig
	isIngest    bool
	url         string
	originalUrl string
	httpClient  *http.Client
	payload     []byte

	closed *atomic.Bool
}

// isIngestEndpoint tells whether the destination URL is exactly the configured global ingest endpoint. It has to be an
// exact match: a suffix match let any URL ending in the endpoint (e.g. http://127.0.0.1:8123/admin#<endpoint>) take
// the unguarded client that is meant for our own service.
func isIngestEndpoint(url string) bool {
	return GlobalIngestEndpoint != "" && strings.TrimRight(url, "/") == strings.TrimRight(GlobalIngestEndpoint, "/")
}

func NewWebhookBulker(bulkerConfig bulker.Config) (bulker.Bulker, error) {
	webhookConfig := WebhookConfig{}
	if err := utils.ParseObject(bulkerConfig.DestinationConfig, &webhookConfig); err != nil {
		return nil, fmt.Errorf("failed to parse destination config: %v", err)
	}
	var payload []byte
	if webhookConfig.CustomPayload {
		pl := WebhookConfigPayload{}
		if err := utils.ParseObject(webhookConfig.Payload, &pl); err != nil {
			return nil, fmt.Errorf("failed to parse payload config: %v", err)
		}
		payload = []byte(pl.Code)
	}
	url := webhookConfig.URL
	originalUrl := url
	isIngest := false
	if isIngestEndpoint(url) {
		isIngest = true
		if LocalIngestEndpoint != "" {
			url = LocalIngestEndpoint
		}
	}

	// The ingest endpoint is our own service reached on its internal address; any other URL is the customer's
	httpClient := &http.Client{Timeout: time.Duration(5) * time.Second}
	if !isIngest {
		httpClient = newOutboundHTTPClient(time.Duration(5) * time.Second)
	}

	return &WebhookBulker{Service: appbase.NewServiceBase(WebhookBulkerTypeId), config: webhookConfig, httpClient: httpClient,
		payload:     payload,
		url:         url,
		originalUrl: originalUrl,
		isIngest:    isIngest,
		closed:      &atomic.Bool{}}, nil

}

func (mp *WebhookBulker) CreateStream(id, tableName string, mode bulker.BulkMode, streamOptions ...bulker.StreamOption) (bulker.BulkerStream, error) {
	switch mode {
	case bulker.Stream:
		return nil, errors.New(WebhookUnsupported)
	case bulker.Batch, bulker.ReplaceTable:
		return NewTransactionalStream(id, mp, tableName, streamOptions...)
	case bulker.ReplacePartition:
		return nil, errors.New(WebhookUnsupported)
	}
	return nil, fmt.Errorf("unsupported bulk mode: %s", mode)
}

func (mp *WebhookBulker) Type() string {
	return WebhookBulkerTypeId
}

func (mp *WebhookBulker) Upload(reader io.Reader, eventsName string, eventsCount int, env map[string]any) (statusCode int, respBody string, err error) {
	if mp.closed.Load() {
		return 0, "", fmt.Errorf("attempt to use closed Webhook instance")
	}

	var body []byte
	if mp.config.CustomPayload {
		body = MacrosRegex.ReplaceAllFunc(mp.payload, func(match []byte) []byte {
			subMatches := MacrosRegex.FindSubmatch(match)
			if len(subMatches) > 1 {
				macroName := string(subMatches[1]) // Extracted macro name (e.g., "EVENT")
				switch strings.ToUpper(macroName) {
				case "EVENT":
					var jsonArray []types.Json
					err = jsonorder.NewDecoder(reader).Decode(&jsonArray)
					if err != nil {
						err = fmt.Errorf("{{ EVENT }} macros: cannot parse json batch: %v", err)
						return match
					}
					if len(jsonArray) > 1 {
						err = fmt.Errorf("{{ EVENT }} macros: expects only one event. Got %d", len(jsonArray))
						return match
					}
					var bts []byte
					bts, err = jsonorder.Marshal(&jsonArray[0])
					if err != nil {
						err = fmt.Errorf("{{ EVENT }} macros: cannot marshal json: %v", err)
						return match
					}
					return bts
				case "EVENTS":
					var bts []byte
					bts, err = io.ReadAll(reader)
					if err != nil {
						err = fmt.Errorf("{{ EVENTS }} macros: cannot read batch: %v", err)
						return match
					}
					return bts
				case "EVENTS_COUNT":
					return []byte(fmt.Sprintf("%d", eventsCount))
				case "NAME", "EVENTS_NAME":
					return []byte(eventsName)
				default:
					if strings.HasPrefix(macroName, "env.") {
						envValue, ok := env[macroName[4:]]
						if !ok {
							return []byte("")
						} else {
							return []byte(fmt.Sprint(envValue))
						}
					} else {
						err = fmt.Errorf("{{ %s }} macros: unknown macro", macroName)
						return match
					}
				}
			}
			return match // Keep unchanged if not found
		})
	} else {
		body, err = io.ReadAll(reader)
	}
	if err != nil {
		return 0, "", err
	}
	for _, retryDelayMs := range retryDelaysMs {
		var req *http.Request
		req, err = http.NewRequest(strings.ToUpper(utils.DefaultString(mp.config.Method, "POST")), mp.url, bytes.NewReader(body))
		if err != nil {
			return 0, "", mp.fixError(err)
		}
		req.Header.Set("Content-Type", "application/json")
		for _, header := range mp.config.Headers {
			headerParts := strings.SplitN(header, ":", 2)
			if len(headerParts) != 2 {
				req.Header.Set(strings.TrimSpace(headerParts[0]), "")
			} else {
				req.Header.Set(strings.TrimSpace(headerParts[0]), strings.TrimSpace(headerParts[1]))
			}
		}
		var res *http.Response
		res, err = mp.httpClient.Do(req)
		if err != nil {
			statusCode = 0
			respBody = ""
			err = mp.fixError(err)
			if mp.isIngest {
				time.Sleep(time.Duration(retryDelayMs) * time.Millisecond)
				continue
			}
			return
		} else {
			defer res.Body.Close()
			var bodyBytes []byte
			statusCode = res.StatusCode
			// the endpoint is customer-controlled: never read more than a small answer into memory
			bodyBytes, err = io.ReadAll(io.LimitReader(res.Body, maxResponseBodyBytes))
			if err != nil {
				respBody = ""
				err = mp.fixError(err)
				if mp.isIngest {
					time.Sleep(time.Duration(retryDelayMs) * time.Millisecond)
					continue
				}
				return
			}
			respBody = string(bodyBytes)
			if statusCode == 200 {
				return statusCode, respBody, nil
			} else if statusCode == 502 || statusCode == 503 {
				err = mp.NewError("http status: %v", statusCode)
				time.Sleep(time.Duration(retryDelayMs) * time.Millisecond)
				continue
			} else {
				return statusCode, respBody, mp.NewError("status: %v err: %v", statusCode, mp.fixError(err))
			}
		}
	}
	return
}

func (mp *WebhookBulker) fixError(err error) error {
	if err == nil {
		return nil
	}
	if mp.isIngest {
		return errors.New(strings.ReplaceAll(err.Error(), mp.url, mp.originalUrl))
	}
	return err
}

func (mp *WebhookBulker) GetBatchFileFormat() types2.FileFormat {
	return types2.FileFormatJSONArray
}
func (mp *WebhookBulker) GetBatchFileCompression() types2.FileCompression {
	return types2.FileCompressionNONE
}

func (mp *WebhookBulker) InmemoryBatch() bool {
	return true
}

func (mp *WebhookBulker) Close() error {
	mp.closed.Store(true)
	mp.httpClient.CloseIdleConnections()
	return nil
}
