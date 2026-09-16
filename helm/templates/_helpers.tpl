{{/*
Expand the name of the chart.
*/}}
{{- define "jitsu.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "jitsu.fullname" -}}
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
{{- define "jitsu.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "jitsu.labels" -}}
helm.sh/chart: {{ include "jitsu.chart" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: jitsu
{{- end }}

{{/*
Selector labels for a specific service
*/}}
{{- define "jitsu.selectorLabels" -}}
app.kubernetes.io/name: {{ .name }}
app.kubernetes.io/instance: {{ .release }}
{{- end }}

{{/*
Host path to the project checkout, mounted into service containers.
No default on purpose — a baked-in path silently mounts an empty dir on
other machines. dev-deploy.sh always passes --set projectRoot=...
*/}}
{{- define "jitsu.projectRoot" -}}
{{- required "projectRoot is not set. Deploy via helm/dev-deploy.sh, or pass --set projectRoot=<absolute path to your newjitsu checkout>" .Values.projectRoot -}}
{{- end }}

{{- define "jitsu.reverseServiceAccount" -}}
{{- default (printf "%s-retl-runner" .Release.Name | trunc 63 | trimSuffix "-") .Values.reverseEtl.serviceAccount.name -}}
{{- end }}

{{/* These settings have one owner: reverseEtl, not generic env overrides. */}}
{{- define "jitsu.validateReverseEtl" -}}
{{- range $vars := list .Values.env.common .Values.env.syncctl -}}
{{- range $key := list "REVERSE_ENABLED" "REVERSE_RUNNER_IMAGE" "REVERSE_RUNTIME_SECRET" "REVERSE_SERVICE_ACCOUNT" "REVERSE_RUNNER_RESOURCES" "REVERSE_SCRATCH_SIZE_LIMIT" -}}
{{- if or (hasKey $vars $key) (hasKey $vars (printf "SYNCCTL_%s" $key)) -}}
{{- fail (printf "configure %s via reverseEtl values, not env.common/env.syncctl" $key) -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- if .Values.reverseEtl.enabled -}}
{{- if not (gt (int .Values.scaling.syncctl.replicas) 0) -}}
{{- fail "reverseEtl.enabled requires scaling.syncctl.replicas > 0" -}}
{{- end -}}
{{- if not (trim .Values.reverseEtl.runnerImage) -}}
{{- fail "reverseEtl.runnerImage is required when enabled" -}}
{{- end -}}
{{- if not (trim .Values.reverseEtl.runtimeSecret) -}}
{{- fail "reverseEtl.runtimeSecret is required when enabled" -}}
{{- end -}}
{{- if not .Values.reverseEtl.serviceAccount.create -}}
{{- if not .Values.reverseEtl.serviceAccount.name -}}
{{- fail "reverseEtl.serviceAccount.name is required when create=false" -}}
{{- end -}}
{{- if .Values.reverseEtl.serviceAccount.annotations -}}
{{- fail "annotate the existing service account externally when create=false" -}}
{{- end -}}
{{- end -}}
{{- if has (include "jitsu.reverseServiceAccount" .) (list "sync-pod" "syncctl" "default") -}}
{{- fail "reverseEtl requires a dedicated service account, not sync-pod/syncctl/default" -}}
{{- end -}}
{{- end -}}
{{- end }}

{{/*
Computed console URL: use in-cluster service when console is deployed, otherwise fall back to env.common.CONSOLE_URL
*/}}
{{- define "jitsu.consoleUrl" -}}
{{- if gt (int .Values.scaling.console.replicas) 0 -}}
http://console:3000
{{- else -}}
{{ required "console is disabled (scaling.console.replicas: 0) but env.common.CONSOLE_URL is not set — services have no console to reach" .Values.env.common.CONSOLE_URL }}
{{- end -}}
{{- end }}

{{/*
Dependency connection URLs (KAFKA_BOOTSTRAP_SERVERS, DATABASE_URL,
CLICKHOUSE_URL, MONGODB_URL) are not computed here: they come from the
`jitsu-deps-urls` Secret published by the ../helm-deps chart, consumed via
envFrom in each service template. env.common overrides still win because
explicit env entries take precedence over envFrom.
*/}}

{{/*
Container env, merged so every name is emitted exactly once — Helm 4 applies
manifests with server-side apply, which rejects duplicate env names
(helm/helm#31529); Helm 3 silently used the last entry.

Value precedence (which definition wins on a name clash), lowest first:
  env.common < computed console/service URLs < template defaults ("extra") < env.<service>
(computed URLs must beat env.common: the in-cluster CONSOLE_URL already folds
in env.common.CONSOLE_URL as its own fallback via jitsu.consoleUrl.)

Emission order (independent of precedence) is chart-provided bases first, user
config last — by the phase that produced each name's *winning* value, ordered:
computed, extra, env.common, env.<service>. Kubernetes $(VAR) expansion only
sees vars defined earlier in the list, so a name whose value references another
must render after it: a user override like env.common.A="$(HTTP_PORT)" emits
after the chart's HTTP_PORT, and even env.<service>.CONSOLE_URL="$(HTTP_PORT)"
(overriding a computed key) emits at the service phase, after HTTP_PORT.
Limitation: two overrides in the *same* phase referencing each other still
order alphabetically — expansion between them is not guaranteed.

Args (dict):
  ctx      — root template context (required)
  service  — key into .Values.env for per-service overrides (required)
  extra    — dict of service-specific defaults the template used to hardcode
  exclude  — list of names the template emits manually (valueFrom entries),
             so a per-service override can't duplicate them
*/}}
{{- define "jitsu.env" -}}
{{- $ctx := .ctx -}}
{{- $consoleUrl := include "jitsu.consoleUrl" $ctx -}}
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
{{- /* Winning value and its source phase per name. Overlay in low→high
       precedence order (env.common < computed < extra < service) so the last
       write wins; record which phase that was for emission ordering. */ -}}
{{- $winner := dict -}}
{{- $source := dict -}}
{{- range $phase := (list
      (dict "name" "common" "vars" $common)
      (dict "name" "computed" "vars" $computed)
      (dict "name" "extra" "vars" $extra)
      (dict "name" "service" "vars" $service)) }}
{{- range $k, $v := $phase.vars }}
{{- $_ := set $winner $k $v }}
{{- $_ := set $source $k $phase.name }}
{{- end }}
{{- end }}
{{- /* Emit each name once, grouped by the phase of its winning value, in
       bases-first order so referenced vars precede the vars that use them. */ -}}
{{- range $phase := (list "computed" "extra" "common" "service") }}
{{- range $k, $v := $winner }}
{{- if and (eq (get $source $k) $phase) (not (has $k $exclude)) }}
- name: {{ $k }}
  value: {{ $v | quote }}
{{- end }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Validate the deployment mode. Called once from every service so a typo fails
the render instead of silently taking the dev branch everywhere.
*/}}
{{- define "jitsu.mode" -}}
{{- $mode := .Values.mode | default "dev" -}}
{{- if not (has $mode (list "dev" "prod")) -}}
{{- fail (printf "mode must be \"dev\" or \"prod\", got %q" $mode) -}}
{{- end -}}
{{- $mode -}}
{{- end }}

{{/*
Resolve a service's runtime container image.

Precedence, highest first:
  1. images.<service>.repository — an explicit pin, honoured in both modes.
     Note what that does NOT give you in dev: the dev templates still mount the
     checkout and override the container command (`/build/ingest`,
     `npx tsx src/index.ts`), so pinning a repository there changes the base
     image while the service keeps running from local source. Pinning is only
     meaningful in prod; in dev it is useful for the base image itself (a
     different node or debian tag), not for running a published build.
  2. prod mode — {{ image.registry }}/<prod repository>:<tag>
  3. dev mode  — the base image the service builds against.

The tag falls back to the chart-wide image.tag; a per-service tag overrides it.
Callers pass the two defaults because they differ per service and per language:
  dev  — golang:1.26-bookworm builds, debian:bookworm-slim runs, node runs tsx
  prod — jitsucom/<name>, which is not always the service name (profiles runs
         the rotor image with ROTOR_MODE=profiles)

Usage:
  image: {{ include "jitsu.image" (dict "ctx" . "service" "ingest"
             "dev" "debian:bookworm-slim" "prod" "ingest") }}
*/}}
{{- define "jitsu.image" -}}
{{- $ctx := .ctx -}}
{{- $images := $ctx.Values.images | default dict -}}
{{- $o := (get $images .service) | default dict -}}
{{- $tag := $o.tag | default $ctx.Values.image.tag -}}
{{- if $o.repository -}}
{{- printf "%s:%s" $o.repository $tag -}}
{{- else if eq (include "jitsu.mode" $ctx) "prod" -}}
{{- printf "%s/%s:%s" $ctx.Values.image.registry .prod $tag -}}
{{- else -}}
{{- .dev -}}
{{- end -}}
{{- end }}

{{/*
imagePullPolicy for a service, or empty when none applies.

Returns the per-service override if set; otherwise the chart default, but only
in prod mode. Dev mode runs public base images where the Kubernetes default is
already right, and emitting nothing there keeps dev renders byte-identical to
what the chart produced before image support existed.

Callers wrap it so the field is omitted entirely when empty:
  {{- with (include "jitsu.imagePullPolicy" (dict "ctx" . "service" "ingest")) }}
  imagePullPolicy: {{ . }}
  {{- end }}
*/}}
{{- define "jitsu.imagePullPolicy" -}}
{{- $ctx := .ctx -}}
{{- $o := (get ($ctx.Values.images | default dict) .service) | default dict -}}
{{- if $o.pullPolicy -}}
{{- $o.pullPolicy -}}
{{- else if eq (include "jitsu.mode" $ctx) "prod" -}}
{{- $ctx.Values.image.pullPolicy -}}
{{- end -}}
{{- end }}

{{/*
Image for the functions-server pods.

Deliberately NOT part of `images:`. Helm does not create these pods — the
operator does, at runtime, one deployment per workspace
(bulker/operator/operator.go:1681), reading the image from its own
FUNCTIONS_SERVER_IMAGE config (bulker/operator/config.go:40). So it is an env
var on the operator, not a container image in this chart, and putting it in
`images:` would imply a pod template that does not exist.

It still has to follow the chart's registry and tag in prod: without this, a
prod install running `latest` everywhere would silently launch function servers
from the `beta` channel, because that is what the dev default pins. Dev keeps
`beta` unchanged.

`env.operator.FUNCTIONS_SERVER_IMAGE` overrides this, as it does any template
default — see the precedence rule on jitsu.env.
*/}}
{{- define "jitsu.functionsServerImage" -}}
{{- if eq (include "jitsu.mode" .) "prod" -}}
{{- printf "%s/functions-server:%s" .Values.image.registry .Values.image.tag -}}
{{- else -}}
{{- "jitsucom/functions-server:beta" -}}
{{- end -}}
{{- end }}

{{/*
Truthy only in dev mode. Wraps the source-build scaffolding — init containers,
hostPath/cache volumes and the explicit `command` that runs a locally built
binary — none of which exist in prod, where the published image ships the
binary and defines its own entrypoint.

  {{- if include "jitsu.isDev" . }}
*/}}
{{- define "jitsu.isDev" -}}
{{- if eq (include "jitsu.mode" .) "dev" }}true{{ end -}}
{{- end }}

{{/*
Service type for a service.

Dev keeps whatever the template declares — four LoadBalancers reached through
`minikube tunnel`, which is how the dev workflow has always worked.

Prod forces ClusterIP for everything. Nothing should get its own cloud load
balancer: the four dev LoadBalancers would provision four of them, billed, with
no TLS and no hostname. External traffic goes through the Ingress instead, which
the ticket scopes to console + ingest — matching production, where bulker is
ClusterIP and rotor is in no gateway config at all.

`service.<name>.type` overrides both, for a self-hoster who genuinely wants a
load balancer per service.

  type: {{ include "jitsu.serviceType" (dict "ctx" . "service" "console" "dev" "LoadBalancer") }}
*/}}
{{- define "jitsu.serviceType" -}}
{{- $ctx := .ctx -}}
{{- $o := (get ($ctx.Values.service | default dict) .service) | default dict -}}
{{- if $o.type -}}
{{- $o.type -}}
{{- else if eq (include "jitsu.mode" $ctx) "prod" -}}
{{- "ClusterIP" -}}
{{- else -}}
{{- .dev -}}
{{- end -}}
{{- end }}

{{/*
The console's PUBLIC url — what a browser types, and what the console hands out
in auth redirects and the tracking snippet. Distinct from jitsu.consoleUrl,
which is the in-cluster address other services call (http://console:3000).

Derived from the Ingress host when there is one, because otherwise a prod
install behind an Ingress still advertises http://localhost:3000: NextAuth
would redirect users there after sign-in, and the tracking snippet would point
browsers at their own machine. Scheme follows ingress.tls.enabled.

Falls back to the dev default. `env.console.NEXTAUTH_URL` /
`env.console.JITSU_PUBLIC_URL` override it, as template defaults always allow —
which is how a self-hoster terminating TLS somewhere else sets it explicitly.
*/}}
{{- define "jitsu.consolePublicUrl" -}}
{{- $ing := .Values.ingress | default dict -}}
{{- $host := (($ing.hosts | default dict).console) -}}
{{- if and (eq (include "jitsu.mode" .) "prod") $ing.enabled $host -}}
{{- $scheme := ternary "https" "http" (($ing.tls | default dict).enabled | default false) -}}
{{- printf "%s://%s" $scheme $host -}}
{{- else -}}
{{- "http://localhost:3000" -}}
{{- end -}}
{{- end }}

{{/*
Dev-only credential defaults.

values.yaml deliberately does not carry JWT_SECRET or SEED_USER_PASSWORD. In
prod the token-generator Job mints them into `jitsu-secrets`, which every
service already mounts via envFrom — so they never appear in a pod spec, in
Helm release metadata (`helm get values`), or in shell history. An explicit
`env.console.*` would override envFrom, which is exactly what we do not want.

Dev has no such Job: dev-deploy.sh's ensure_secrets() writes only the eight
inter-service keys. So dev gets its long-standing literals from here instead,
keeping the Minikube quick start a single command.

  {{- with (include "jitsu.devCredential" (dict "ctx" . "key" "JWT_SECRET")) }}
*/}}
{{- define "jitsu.devCredential" -}}
{{- if eq (include "jitsu.mode" .ctx) "dev" -}}
{{- if eq .key "JWT_SECRET" }}dev-jwt-secret-change-in-production{{ end -}}
{{- if eq .key "SEED_USER_PASSWORD" }}changeme{{ end -}}
{{- end -}}
{{- end }}

{{/*
Image for the sync sidecar pods, or empty in dev.

Same shape as jitsu.functionsServerImage and the same reason for not living in
`images:`: Helm does not create these pods. syncctl does, as CronJobs, reading
SIDECAR_IMAGE from its own config (bulker/sync-controller/config.go:37).

JITSU-48 splits sidecar's *dev* mode out into its own task but requires prod
mode to cover it via images, which is this. Without it a prod install pinned to
a version would still launch sync pods from `jitsucom/sidecar:latest` — the Go
default — silently mixing versions.

Empty in dev, where that Go default is what the chart has always relied on and
emitting the variable would change nothing except the rendered output.
*/}}
{{- define "jitsu.sidecarImage" -}}
{{- if eq (include "jitsu.mode" .) "prod" -}}
{{- printf "%s/sidecar:%s" .Values.image.registry .Values.image.tag -}}
{{- end -}}
{{- end }}

{{/*
The ingest endpoint's PUBLIC url, or empty when there is none to derive.

The console hands this to the browser via /api/app-config
(pages/api/app-config.ts:32) — it is what the tracking-installation UI tells
people to send events to. Configuring an Ingress host for ingest without also
telling the console about it leaves that UI advertising the wrong endpoint, so
it is derived from the same value rather than configured twice.

Scheme follows ingress.tls.enabled, as with jitsu.consolePublicUrl.
`env.console.JITSU_INGEST_PUBLIC_URL` overrides it — the escape hatch when
ingest is exposed somewhere the chart does not know about.
*/}}
{{- define "jitsu.ingestPublicUrl" -}}
{{- $ing := .Values.ingress | default dict -}}
{{- $host := (($ing.hosts | default dict).ingest) -}}
{{- if and (eq (include "jitsu.mode" .) "prod") $ing.enabled $host -}}
{{- $scheme := ternary "https" "http" (($ing.tls | default dict).enabled | default false) -}}
{{- printf "%s://%s" $scheme $host -}}
{{- end -}}
{{- end }}

{{/*
Pod annotations that force a coordinated restart when the credentials change.

Only meaningful in prod with an explicit `auth.token`: that path renders
secrets.yaml, and changing the value rewrites `jitsu-secrets`. The Deployments'
`envFrom` reference is textually identical either way, so without this Helm sees
no change and never rolls them — running pods keep the old keys while any pod
that restarts for an unrelated reason picks up the new ones and can no longer
authenticate to the others. JWT_SECRET moving also invalidates live sessions.

On the generated path secrets.yaml renders nothing and the Job creates the Secret
only when absent, so the digest is constant and nothing rolls.

Emitted in prod only, so the dev render stays byte-identical.
*/}}
{{- define "jitsu.credentialChecksum" -}}
checksum/credentials: {{ include (print .Template.BasePath "/secrets.yaml") . | sha256sum }}
{{- end -}}

{{/*
Whether a service should get the dev build scaffolding: the `build` init
container that compiles from the mounted checkout, the command override that
runs its output, and the volumes behind both.

True in dev *unless* the service carries an explicit `images.<service>.repository`
pin. The ticket asks for two things that look contradictory —

  "per-service image override wins — used regardless of mode"
  "the existing Minikube dev flow must keep working unchanged"

— but they only collide if "the dev flow" means every possible dev render. It
means the *default* one. Pinning a repository is an explicit opt-in by someone
choosing a published build for that one service, and honouring it changes nothing
for anyone who does not set it. Without this, a pin in dev sets the base image
while the command override keeps the service running local source — the image is
used, the build in it is not, which is not what "used" means.

The invariant to check after touching this: `helm template` with no pins must
stay byte-identical, and a pinned service must render with no init container and
no command override.

  {{- if include "jitsu.devScaffold" (dict "ctx" . "service" "ingest") }}
*/}}
{{- define "jitsu.devScaffold" -}}
{{- $ctx := .ctx -}}
{{- if eq (include "jitsu.mode" $ctx) "dev" -}}
{{- $o := (get ($ctx.Values.images | default dict) .service) | default dict -}}
{{- if not $o.repository -}}true{{- end -}}
{{- end -}}
{{- end }}
