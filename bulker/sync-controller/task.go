package main

import (
	"bytes"
	"compress/gzip"
	"time"

	"github.com/jitsucom/bulker/jitsubase/jsonorder"
	"github.com/mitchellh/mapstructure"
)

const annotationPromScrape = "prometheus.io/scrape"

type TaskDescriptor struct {
	TaskID          string `json:"taskId"`
	TaskType        string `json:"taskType"` //spec, discover, read, check
	WorkspaceId     string `json:"workspaceId"`
	SyncID          string `json:"syncId"`
	SourceType      string `json:"sourceType"`
	StorageKey      string `json:"storageKey"`
	Protocol        string `json:"protocol"`
	Package         string `json:"package"`
	PackageVersion  string `json:"packageVersion"`
	Namespace       string `json:"namespace"`
	ToSameCase      string `json:"sameCase"`
	AddMeta         string `json:"addMeta"`
	Deduplicate     string `json:"deduplicate"`
	TableNamePrefix string `json:"tableNamePrefix"`
	FullSync        string `json:"fullSync"`
	Debug           string `json:"debug"`
	StartedBy       string `json:"startedBy"`
	StartedAt       string `json:"startedAt"`
	ThenRun         string `json:"thenRun"`
}

func (t *TaskDescriptor) PodName() string {
	return PodName(t.SyncID, t.TaskID, t.Package, t.TaskType)
}
func (t *TaskDescriptor) StartedAtTime() time.Time {
	tm, err := time.Parse(time.RFC3339, t.StartedAt)
	if err != nil {
		return time.Now()
	}
	return tm
}

func (t *TaskDescriptor) ExtractAnnotations() map[string]string {
	rawAnnotations := map[string]string{}
	_ = mapstructure.Decode(t, &rawAnnotations)
	annotations := make(map[string]string, len(rawAnnotations))
	annotations[annotationPromScrape] = "false"
	for k, v := range rawAnnotations {
		if v != "" {
			annotations[k] = v
		}
	}
	return annotations
}

type TaskStatus struct {
	TaskDescriptor `json:",inline" mapstructure:",squash" `
	PodName        string         `json:"podName"`
	Status         Status         `json:"status"`
	Description    string         `json:"description"`
	Error          string         `json:"error"`
	Metrics        map[string]any `json:"metrics"`
}

type Status string

const (
	StatusRunning        Status = "RUNNING"
	StatusFailed         Status = "FAILED"
	StatusTimeExceeded   Status = "TIME_EXCEEDED"
	StatusSuccess        Status = "SUCCESS"
	StatusCreated        Status = "CREATED"
	StatusCreateFailed   Status = "CREATE_FAILED"
	StatusAlreadyCreated Status = "ALREADY_CREATED"
	StatusInitTimeout    Status = "INIT_TIMEOUT"
	StatusPending        Status = "PENDING"
	StatusUnknown        Status = "UNKNOWN"
)

type TaskConfiguration struct {
	Config            map[string]any                     `json:"config"`
	Catalog           *jsonorder.OrderedMap[string, any] `json:"catalog"`
	State             any                                `json:"state"`
	DestinationConfig map[string]any                     `json:"destinationConfig"`
	FunctionsEnv      map[string]any                     `json:"functionsEnv"`
}

func (t *TaskConfiguration) IsEmpty() bool {
	return t == nil || (t.Config == nil && t.Catalog == nil && t.State == nil)
}

func gzipJson(json any) []byte {
	var gzipBuffer bytes.Buffer
	gzipWriter, _ := gzip.NewWriterLevel(&gzipBuffer, gzip.BestCompression)
	encoder := jsonorder.NewEncoder(gzipWriter)
	_ = encoder.Encode(json)
	_ = gzipWriter.Close()
	gzippedData := gzipBuffer.Bytes()
	return gzippedData
}

func (t *TaskConfiguration) Keys() []string {
	if t == nil {
		return nil
	}
	m := make([]string, 0)
	if t.Config != nil {
		m = append(m, "config")
	}
	if t.Catalog != nil {
		m = append(m, "catalog")
	}
	if t.State != nil {
		m = append(m, "state")
	}
	if t.DestinationConfig != nil {
		m = append(m, "destinationConfig")
	}
	return m
}

func (t *TaskConfiguration) ToMap() map[string][]byte {
	if t == nil {
		return nil
	}
	m := map[string][]byte{}
	if t.Config != nil {
		m["config"] = gzipJson(t.Config)
	}
	if t.Catalog != nil {
		m["catalog"] = gzipJson(t.Catalog)
	}
	if t.State != nil {
		m["state"] = gzipJson(t.State)
	}
	if t.DestinationConfig != nil {
		m["destinationConfig"] = gzipJson(t.DestinationConfig)
	}
	return m
}
