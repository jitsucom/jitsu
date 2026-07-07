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
Container env, merged so every name is emitted exactly once — Helm 4 applies
manifests with server-side apply, which rejects duplicate env names
(helm/helm#31529); Helm 3 silently used the last entry.

Value precedence (which definition wins on a name clash), lowest first:
  env.common < computed console/service URLs < template defaults ("extra") < env.<service>
(computed URLs must beat env.common: the in-cluster CONSOLE_URL already folds
in env.common.CONSOLE_URL as its own fallback via jitsu-dev.consoleUrl.)

Emission order (independent of precedence) is chart-provided bases first, user
config last: computed, extra, env.common, env.<service>. Kubernetes $(VAR)
expansion only sees vars defined earlier in the list, so a user override like
env.common.A="$(HTTP_PORT)" must render after the chart's HTTP_PORT. Each name
is emitted at its first appearance in that order, carrying its winning value.

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
{{- $common := $ctx.Values.env.common | default dict -}}
{{- $extra := .extra | default dict -}}
{{- $service := index $ctx.Values.env .service | default dict -}}
{{- $exclude := .exclude | default list -}}
{{- /* Winning value per name: overlay low→high precedence so the last write wins. */ -}}
{{- $winner := dict -}}
{{- range $k, $v := $common }}{{- $_ := set $winner $k $v }}{{- end }}
{{- range $k, $v := $computed }}{{- $_ := set $winner $k $v }}{{- end }}
{{- range $k, $v := $extra }}{{- $_ := set $winner $k $v }}{{- end }}
{{- range $k, $v := $service }}{{- $_ := set $winner $k $v }}{{- end }}
{{- /* Emit in bases-first order, each name once at its first appearance. */ -}}
{{- $emitted := dict -}}
{{- range $group := (list $computed $extra $common $service) }}
{{- range $k, $_v := $group }}
{{- if and (not (hasKey $emitted $k)) (not (has $k $exclude)) }}
{{- $_ := set $emitted $k true }}
- name: {{ $k }}
  value: {{ get $winner $k | quote }}
{{- end }}
{{- end }}
{{- end }}
{{- end }}
