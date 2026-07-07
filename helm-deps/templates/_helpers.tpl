{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "jitsu-deps.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "jitsu-deps.labels" -}}
helm.sh/chart: {{ include "jitsu-deps.chart" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: jitsu
{{- end }}
