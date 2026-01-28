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
Common environment variables
*/}}
{{- define "jitsu-dev.commonEnv" -}}
{{- range $key, $value := .Values.env.common }}
- name: {{ $key }}
  value: {{ $value | quote }}
{{- end }}
{{- with .Values.env.common }}
- name: CONSOLE_URL
  value: {{ .CONSOLE_URL | quote }}
- name: REPOSITORY_URL
  value: "{{ .CONSOLE_URL }}/api/admin/export/streams-with-destinations"
- name: REPOSITORY_BASE_URL
  value: "{{ .CONSOLE_URL }}/api/admin/export"
- name: SCRIPT_ORIGIN
  value: "{{ .CONSOLE_URL }}/api/s/javascript-library"
- name: CONFIG_SOURCE
  value: "{{ .CONSOLE_URL }}/api/admin/export/bulker-connections"
{{- end }}
{{- end }}

{{/*
Inter-service URLs (k8s service discovery)
*/}}
{{- define "jitsu-dev.serviceUrls" -}}
- name: ROTOR_URL
  value: "http://rotor:3401"
- name: BULKER_URL
  value: "http://bulker:3042"
- name: INGEST_URL
  value: "http://ingest:3049"
- name: SYNCCTL_URL
  value: "http://syncctl:3043"
{{- end }}


