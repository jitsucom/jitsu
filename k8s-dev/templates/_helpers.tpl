{{/*
Expand the name of the chart.
*/}}
{{- define "jitsu-dev.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "jitsu-dev.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "jitsu-dev.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "jitsu-dev.labels" -}}
helm.sh/chart: {{ include "jitsu-dev.chart" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: jitsu
{{- end }}

{{/*
Selector labels for a specific service
*/}}
{{- define "jitsu-dev.selectorLabels" -}}
app.kubernetes.io/name: {{ .name }}
app.kubernetes.io/instance: {{ .release }}
{{- end }}

{{/*
Common environment variables from host services
*/}}
{{- define "jitsu-dev.hostEnv" -}}
{{- with .Values.hostServices.kafka }}
- name: KAFKA_BOOTSTRAP_SERVERS
  value: {{ .brokers | quote }}
{{- end }}
{{- with .Values.hostServices.console }}
- name: CONSOLE_URL
  value: {{ .url | quote }}
- name: REPOSITORY_URL
  value: "{{ .url }}/api/admin/export/streams-with-destinations"
- name: REPOSITORY_BASE_URL
  value: "{{ .url }}/api/admin/export"
- name: SCRIPT_ORIGIN
  value: "{{ .url }}/api/s/javascript-library"
- name: CONFIG_SOURCE
  value: "{{ .url }}/api/admin/export/bulker-connections"
{{- end }}
{{- end }}

{{/*
Common environment variables
*/}}
{{- define "jitsu-dev.commonEnv" -}}
{{- range $key, $value := .Values.commonEnv }}
- name: {{ $key }}
  value: {{ $value | quote }}
{{- end }}
{{- end }}

{{/*
Inter-service URLs (k8s service discovery)
*/}}
{{- define "jitsu-dev.serviceUrls" -}}
- name: ROTOR_URL
  value: "http://rotor:{{ .Values.rotor.port }}"
- name: BULKER_URL
  value: "http://bulker:{{ .Values.bulker.port }}"
- name: INGEST_URL
  value: "http://ingest:{{ .Values.ingest.port }}"
- name: SYNCCTL_URL
  value: "http://syncctl:{{ .Values.syncctl.port }}"
{{- end }}

{{/*
ClickHouse configuration (non-secret)
*/}}
{{- define "jitsu-dev.clickhouseEnv" -}}
{{- with .Values.clickhouse }}
{{- if .host }}
- name: CLICKHOUSE_HOST
  value: {{ .host | quote }}
{{- end }}
{{- if .url }}
- name: CLICKHOUSE_URL
  value: {{ .url | quote }}
{{- end }}
{{- if .username }}
- name: CLICKHOUSE_USERNAME
  value: {{ .username | quote }}
{{- end }}
{{- if .database }}
- name: CLICKHOUSE_DATABASE
  value: {{ .database | quote }}
{{- end }}
{{- if .metricsSchema }}
- name: CLICKHOUSE_METRICS_SCHEMA
  value: {{ .metricsSchema | quote }}
{{- end }}
- name: CLICKHOUSE_SSL
  value: {{ .ssl | default "true" | quote }}
{{- end }}
{{- end }}

