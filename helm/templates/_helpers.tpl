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
Container env, merged into a single map so every name is emitted exactly
once — Helm 4 applies manifests with server-side apply, which rejects
duplicate env names (helm/helm#31529); Helm 3 silently used the last entry.
Precedence, later wins:
  env.common < computed console/service URLs < template defaults ("extra") < env.<service>
Args (dict):
  ctx      — root template context (required)
  service  — key into .Values.env for per-service overrides (required)
  extra    — dict of service-specific defaults the template used to hardcode
  exclude  — list of names the template emits manually (valueFrom entries),
             so a per-service override can't duplicate them
*/}}
{{- define "jitsu-dev.env" -}}
{{- $ctx := .ctx -}}
{{- $consoleUrl := include "jitsu-dev.consoleUrl" $ctx -}}
{{- $computed := dict
      "CONSOLE_URL" $consoleUrl
      "REPOSITORY_URL" (printf "%s/api/admin/export/streams-with-destinations" $consoleUrl)
      "REPOSITORY_BASE_URL" (printf "%s/api/admin/export" $consoleUrl)
      "SCRIPT_ORIGIN" (printf "%s/api/s/javascript-library" $consoleUrl)
      "CONFIG_SOURCE" (printf "%s/api/admin/export/bulker-connections" $consoleUrl)
      "ROTOR_URL" "http://rotor:3401"
      "BULKER_URL" "http://bulker:3042"
      "INGEST_URL" "http://ingest:3049"
      "SYNCCTL_URL" "http://syncctl:3043"
-}}
{{- $phases := list
      ($ctx.Values.env.common | default dict)
      $computed
      (.extra | default dict)
      (index $ctx.Values.env .service | default dict)
-}}
{{- $exclude := .exclude | default list -}}
{{- /* Emit each key once, at the phase of its winning (last) definition,
       alphabetical within a phase. Position matters beyond aesthetics:
       Kubernetes $(VAR) expansion only sees vars defined earlier in the
       list, so an override referencing a chart-provided var must render
       after it. */ -}}
{{- range $i, $phase := $phases }}
{{- range $key, $value := $phase }}
{{- $winner := true }}
{{- range $j, $later := $phases }}
{{- if and (gt $j $i) (hasKey $later $key) }}{{- $winner = false }}{{- end }}
{{- end }}
{{- if and $winner (not (has $key $exclude)) }}
- name: {{ $key }}
  value: {{ $value | quote }}
{{- end }}
{{- end }}
{{- end }}
{{- end }}
