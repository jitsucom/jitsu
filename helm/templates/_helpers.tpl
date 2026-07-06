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
Host path to the project checkout, mounted into service containers.
No default on purpose — a baked-in path silently mounts an empty dir on
other machines. dev-deploy.sh always passes --set projectRoot=...
*/}}
{{- define "jitsu-dev.projectRoot" -}}
{{- required "projectRoot is not set. Deploy via helm/dev-deploy.sh, or pass --set projectRoot=<absolute path to your newjitsu checkout>" .Values.projectRoot -}}
{{- end }}

{{/*
Computed console URL: use in-cluster service when console is deployed, otherwise fall back to env.common.CONSOLE_URL
*/}}
{{- define "jitsu-dev.consoleUrl" -}}
{{- if gt (int .Values.scaling.console.replicas) 0 -}}
http://console:3000
{{- else -}}
{{ .Values.env.common.CONSOLE_URL }}
{{- end -}}
{{- end }}

{{/*
Common environment variables
*/}}
{{- define "jitsu-dev.commonEnv" -}}
{{- $consoleUrl := include "jitsu-dev.consoleUrl" . -}}
{{- range $key, $value := .Values.env.common }}
{{- if ne $key "CONSOLE_URL" }}
- name: {{ $key }}
  value: {{ $value | quote }}
{{- end }}
{{- end }}
- name: CONSOLE_URL
  value: {{ $consoleUrl | quote }}
- name: REPOSITORY_URL
  value: "{{ $consoleUrl }}/api/admin/export/streams-with-destinations"
- name: REPOSITORY_BASE_URL
  value: "{{ $consoleUrl }}/api/admin/export"
- name: SCRIPT_ORIGIN
  value: "{{ $consoleUrl }}/api/s/javascript-library"
- name: CONFIG_SOURCE
  value: "{{ $consoleUrl }}/api/admin/export/bulker-connections"
{{- end }}

{{/*
Inter-service URLs (k8s service discovery).
CONSOLE_URL is emitted by commonEnv — don't add it here, duplicate env
names fail strict server-side validation on newer Kubernetes.
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
