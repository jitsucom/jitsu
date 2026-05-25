package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"time"

	"github.com/jitsucom/bulker/jitsubase/utils"
	v1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/utils/ptr"
)

// manualPodAppValue tags one-shot Pods syncctl spawns in response to manual
// HTTP requests. Mirrors cronJobAppValue so dashboards can distinguish
// scheduled fires from manual runs while watchPodStatuses keeps observing
// both via the creator label.
const manualPodAppValue = "sync-manual"

// SyncOptions is the parsed shape of SyncEntry.Options + the equivalent
// inline blob shipped for ad-hoc check/discover when no SyncEntry exists.
type SyncOptions struct {
	SchemaChanges   string          `json:"schemaChanges"`
	VersionHash     string          `json:"versionHash"`
	Namespace       string          `json:"namespace"`
	TableNamePrefix string          `json:"tableNamePrefix"`
	ToSameCase      bool            `json:"toSameCase"`
	AddMeta         bool            `json:"addMeta"`
	Deduplicate     *bool           `json:"deduplicate"`
	FunctionsEnv    json.RawMessage `json:"functionsEnv"`
}

func parseSyncOptions(raw json.RawMessage) SyncOptions {
	var opts SyncOptions
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &opts)
	}
	return opts
}

func (o SyncOptions) DeduplicateFlag() bool {
	if o.Deduplicate != nil {
		return *o.Deduplicate
	}
	return true
}

// PodCtx is the consolidated input to buildSyncPodTemplate. Every Pod syncctl
// materializes — cron-fired read or manual spec/check/discover/read — flows
// through this struct, so the init-container chain and env scaffolding stay
// in one place.
//
// Exactly one of Entry / Inline is set:
//   - Entry  — sync-bound runs (cron read, manual read, manual sync-bound discover).
//     Source/destination configs + Options come from the entry.
//   - Inline — pre-save UX (spec/check, pre-save discover). Caller supplies
//     {package, version, source config wrapper, destination config}.
type PodCtx struct {
	TaskType    string // spec / check / discover / read
	WorkspaceID string
	SyncID      string // required when Entry is set
	TaskID      string // for cron read leave empty → field-ref to metadata.name
	StorageKey  string
	StartedBy   string // JSON literal: `{"trigger":"scheduled"}` / `{"trigger":"manual",...}`

	Entry  *SyncEntry
	Inline *InlinePayload

	// Cron=true enables admission's jitter (sub-minute spread for syncs that
	// share a schedule). Manual runs always skip jitter.
	Cron bool

	// Per-run overrides forwarded from query string. Empty string means "not
	// supplied" — the sidecar's env-driven defaults apply.
	FullSync string
	Debug    string
}

// InlinePayload is the pre-save UX path's request body wrapped as a value the
// builder can consume the same way it consumes SyncEntry.
type InlinePayload struct {
	Package           string          `json:"package"`
	Version           string          `json:"version"`
	StorageKey        string          `json:"storageKey"`
	Source            json.RawMessage `json:"source"`            // wrapper {package,version,authorized,credentials}
	DestinationConfig json.RawMessage `json:"destinationConfig"` // raw destination config
	Options           json.RawMessage `json:"options"`           // rarely set inline
}

// PackageRef returns the (package, version, storageKey) tuple regardless of
// whether the run is sync-bound or inline.
func (c *PodCtx) PackageRef() (pkg, version, storageKey string) {
	if c.Entry != nil {
		opts := parseSyncOptions(c.Entry.Options)
		return c.Entry.Source.Package, c.Entry.Source.Version, opts.VersionHash
	}
	if c.Inline != nil {
		return c.Inline.Package, c.Inline.Version, c.Inline.StorageKey
	}
	return "", "", ""
}

// Options returns the parsed SyncOptions for whichever payload variant the
// PodCtx carries.
func (c *PodCtx) Options() SyncOptions {
	if c.Entry != nil {
		return parseSyncOptions(c.Entry.Options)
	}
	if c.Inline != nil {
		return parseSyncOptions(c.Inline.Options)
	}
	return SyncOptions{}
}

// SourceWrapperJSON returns the bytes destined for serviceConfig.json inside
// the per-Pod Secret — the {package, version, authorized, credentials} blob
// that oauth-refresh reads to decide whether to call Nango.
func (c *PodCtx) SourceWrapperJSON() ([]byte, error) {
	if c.Entry != nil {
		return json.Marshal(c.Entry.Source)
	}
	if c.Inline != nil && len(c.Inline.Source) > 0 {
		return c.Inline.Source, nil
	}
	return nil, fmt.Errorf("PodCtx has no source config to materialize")
}

// DestinationConfigJSON returns destinationConfig.json bytes. May be nil for
// spec/check/discover that don't need a destination.
func (c *PodCtx) DestinationConfigJSON() []byte {
	if c.Entry != nil {
		return c.Entry.Destination
	}
	if c.Inline != nil {
		return c.Inline.DestinationConfig
	}
	return nil
}

// needsConfigSecret reports whether the Pod needs a serviceConfig.json
// (i.e. anything past `spec`).
func (c *PodCtx) needsConfigSecret() bool {
	return c.TaskType != "spec"
}

// needsAdmission reports whether the admission init container (quota +
// lease) should run. Only `read` gates on admission — spec/check/discover
// are independent of per-sync leasing & quota.
func (c *PodCtx) needsAdmission() bool {
	return c.TaskType == "read"
}

// needsLeaseRenewal reports whether the sidecar should renew the per-sync
// Lease in the background. Only read holds a lease.
func (c *PodCtx) needsLeaseRenewal() bool {
	return c.TaskType == "read"
}

// needsLoadCatalogState reports whether the load-catalog-state init runs.
// Only read consumes catalog+state files.
func (c *PodCtx) needsLoadCatalogState() bool {
	return c.TaskType == "read"
}

// needsOauthRefresh reports whether the oauth-refresh init runs. spec doesn't
// need it (no config); everything else does.
func (c *PodCtx) needsOauthRefresh() bool {
	return c.TaskType != "spec"
}

// needsDiscoverInit returns true when the read Pod should run a discover
// pass before load-catalog-state, to refresh the catalog when the user
// requested it (Options.SchemaChanges == fields/streams). Only applies to
// the read task type; the standalone discover task uses the source's
// discover command as the main container instead.
func (c *PodCtx) needsDiscoverInit() bool {
	if c.TaskType != "read" {
		return false
	}
	opts := c.Options()
	return opts.SchemaChanges == "fields" || opts.SchemaChanges == "streams"
}

// sourceCommand returns the shell command run inside the `source` container
// for non-read tasks. read has its own command (uses /shared/catalog.json +
// state.json) and writes through pipes; the others write straight to pipes
// without state/catalog inputs.
func (c *PodCtx) sourceCommand() string {
	switch c.TaskType {
	case "spec":
		return `eval "$AIRBYTE_ENTRYPOINT spec" 2> /pipes/stderr > /pipes/stdout`
	case "check":
		return `eval "$AIRBYTE_ENTRYPOINT check --config /shared/config.json" 2> /pipes/stderr > /pipes/stdout`
	case "discover":
		return `eval "$AIRBYTE_ENTRYPOINT discover --config /shared/config.json" 2> /pipes/stderr > /pipes/stdout`
	case "read":
		debug := ""
		if c.Debug == "true" {
			debug = "--debug "
		}
		return fmt.Sprintf(`eval "$AIRBYTE_ENTRYPOINT read %s--config /shared/config.json --catalog /shared/catalog.json --state /shared/state.json" 2> /pipes/stderr > /pipes/stdout`, debug)
	}
	return ""
}

// startedByOrDefault returns the StartedBy JSON, defaulting based on Cron flag
// when the caller didn't supply one.
func (c *PodCtx) startedByOrDefault() string {
	if c.StartedBy != "" {
		return c.StartedBy
	}
	if c.Cron {
		return `{"trigger":"scheduled"}`
	}
	return `{"trigger":"manual"}`
}

// buildSyncPodTemplate is the single source of truth for the autonomous
// (init-container-driven) Pod layout. cron reconciler wraps it in a
// JobTemplateSpec; manual one-shots wrap it in a bare Pod.
//
// secretName is the in-namespace Secret containing serviceConfig.json (and,
// for read, destinationConfig.json). Caller is responsible for creating it
// before the Pod starts.
func buildSyncPodTemplate(c *Config, pc PodCtx, secretName string) v1.PodTemplateSpec {
	opts := pc.Options()
	pkg, ver, storageKey := pc.PackageRef()
	sourceImage := fmt.Sprintf("%s:%s", pkg, ver)
	databaseURL := utils.NvlString(c.SidecarDatabaseURL, c.DatabaseURL)

	configMount := v1.VolumeMount{Name: "config", MountPath: "/config"}
	sharedMount := v1.VolumeMount{Name: "shared", MountPath: "/shared"}
	pipesMount := v1.VolumeMount{Name: "pipes", MountPath: "/pipes"}

	syncID := pc.SyncID
	if syncID == "" && pc.Entry != nil {
		syncID = pc.Entry.ID
	}
	workspaceID := pc.WorkspaceID
	if workspaceID == "" && pc.Entry != nil {
		workspaceID = pc.Entry.WorkspaceID
	}
	fromID := ""
	if pc.Entry != nil {
		fromID = pc.Entry.FromID
	}
	startedBy := pc.startedByOrDefault()

	// Env shared by every sync-sidecar invocation in the Pod (init + main).
	baseEnv := []v1.EnvVar{
		{Name: "SYNC_ID", Value: syncID},
		{Name: "WORKSPACE_ID", Value: workspaceID},
		{Name: "FROM_ID", Value: fromID},
		{Name: "PACKAGE", Value: pkg},
		{Name: "PACKAGE_VERSION", Value: ver},
		{Name: "STORAGE_KEY", Value: storageKey},
		{Name: "DATABASE_URL", Value: databaseURL},
		{Name: "KUBE_NAMESPACE", Value: c.KubernetesNamespace},
		{Name: "POD_NAME", ValueFrom: &v1.EnvVarSource{FieldRef: &v1.ObjectFieldSelector{FieldPath: "metadata.name"}}},
		{Name: "LOG_LEVEL", Value: c.LogLevel},
		{Name: "DB_LOG_LEVEL", Value: c.DBLogLevel},
	}

	// TASK_ID env: for cron reads the descriptor's TaskID is empty by design
	// (each fire gets a unique pod-name TaskID); set via field-ref so the
	// sidecar sees the same string watchPodStatuses derives from pod.Name.
	// Manual runs supply a concrete TaskID via the caller.
	var taskIDEnv v1.EnvVar
	if pc.TaskID == "" {
		taskIDEnv = v1.EnvVar{Name: "TASK_ID", ValueFrom: &v1.EnvVarSource{FieldRef: &v1.ObjectFieldSelector{FieldPath: "metadata.name"}}}
	} else {
		taskIDEnv = v1.EnvVar{Name: "TASK_ID", Value: pc.TaskID}
	}

	var initContainers []v1.Container

	if pc.needsAdmission() {
		// admission: combined gate that runs jitter → quota-check → lease-acquire
		// in a single init container (sidecar subcommand `admission`). Manual
		// reads disable jitter via JITTER_MAX_SECONDS=0; cron reads keep it.
		jitterMax := 0
		if pc.Cron {
			jitterMax = int(c.JitterMaxSeconds)
		}
		admissionEnv := append([]v1.EnvVar{}, baseEnv...)
		admissionEnv = append(admissionEnv,
			v1.EnvVar{Name: "CONSOLE_URL", Value: c.ConsoleURL},
			v1.EnvVar{Name: "CONSOLE_TOKEN", Value: c.ConsoleToken},
			v1.EnvVar{Name: "JITTER_MAX_SECONDS", Value: strconv.Itoa(jitterMax)},
			taskIDEnv,
			v1.EnvVar{Name: "STARTED_BY", Value: startedBy},
		)
		initContainers = append(initContainers, v1.Container{
			Name:      "admission",
			Image:     c.SidecarImage,
			Command:   []string{"/app/sidecar", "admission"},
			Env:       admissionEnv,
			Resources: smallResources(),
		})
	}

	if pc.needsOauthRefresh() {
		// oauth-refresh: reads /config/serviceConfig.json, unwraps `credentials`
		// (calling Nango first when authorized=true) and writes the airbyte
		// config to /shared/config.json. Also copies /config/destinationConfig.json
		// to /shared/destinationConfig.json when present.
		oauthEnv := append([]v1.EnvVar{}, baseEnv...)
		oauthEnv = append(oauthEnv,
			v1.EnvVar{Name: "NANGO_API_HOST", Value: c.NangoAPIHost},
			v1.EnvVar{Name: "NANGO_SECRET_KEY", Value: c.NangoSecretKey},
			v1.EnvVar{Name: "GOOGLE_ADS_DEVELOPER_TOKEN", Value: c.GoogleAdsDeveloperToken},
		)
		initContainers = append(initContainers, v1.Container{
			Name:         "oauth-refresh",
			Image:        c.SidecarImage,
			Command:      []string{"/app/sidecar", "oauth-refresh"},
			Env:          oauthEnv,
			VolumeMounts: []v1.VolumeMount{configMount, sharedMount},
			Resources:    smallResources(),
		})
	}

	if pc.needsDiscoverInit() {
		// Inline discover before load-catalog-state when SchemaChanges asked
		// for it. Capture mixed JSONL output to /shared/discover.jsonl for
		// load-catalog-state to parse.
		initContainers = append(initContainers, v1.Container{
			Name:  "discover",
			Image: sourceImage,
			Command: []string{"sh", "-c",
				`eval "$AIRBYTE_ENTRYPOINT discover --config /shared/config.json" > /shared/discover.jsonl 2> /shared/discover.stderr`},
			Env: []v1.EnvVar{
				{Name: "USE_STREAM_CAPABLE_STATE", Value: "true"},
				{Name: "AUTO_DETECT_SCHEMA", Value: "true"},
			},
			VolumeMounts: []v1.VolumeMount{sharedMount},
			Resources:    sourceResources(),
		})
	}

	if pc.needsLoadCatalogState() {
		loadEnv := append([]v1.EnvVar{}, baseEnv...)
		optionsJSON := ""
		if pc.Entry != nil {
			optionsJSON = string(pc.Entry.Options)
		} else if pc.Inline != nil {
			optionsJSON = string(pc.Inline.Options)
		}
		loadEnv = append(loadEnv, v1.EnvVar{Name: "OPTIONS_JSON", Value: optionsJSON})
		initContainers = append(initContainers, v1.Container{
			Name:         "load-catalog-state",
			Image:        c.SidecarImage,
			Command:      []string{"/app/sidecar", "load-catalog-state"},
			Env:          loadEnv,
			VolumeMounts: []v1.VolumeMount{configMount, sharedMount},
			Resources:    smallResources(),
		})
	}

	// pipes-init: always present (creates the FIFOs source ↔ sidecar share).
	initContainers = append(initContainers, v1.Container{
		Name:         "pipes-init",
		Image:        "alpine",
		Command:      []string{"sh", "-c", "mkfifo /pipes/stdout; mkfifo /pipes/stderr; chmod 777 /pipes/*"},
		VolumeMounts: []v1.VolumeMount{pipesMount},
		Resources:    smallResources(),
	})

	// Sidecar env. COMMAND tells the sidecar which subprotocol to run; the
	// existing sidecar code dispatches on this value.
	sidecarEnv := append([]v1.EnvVar{}, baseEnv...)
	sidecarEnv = append(sidecarEnv,
		v1.EnvVar{Name: "STDOUT_PIPE_FILE", Value: "/pipes/stdout"},
		v1.EnvVar{Name: "STDERR_PIPE_FILE", Value: "/pipes/stderr"},
		v1.EnvVar{Name: "COMMAND", Value: pc.TaskType},
		v1.EnvVar{Name: "TASK_TIMEOUT_HOURS", Value: strconv.Itoa(c.TaskTimeoutHours)},
		v1.EnvVar{Name: "LOCAL_INGEST_ENDPOINT", Value: c.LocalIngestEndpoint},
		v1.EnvVar{Name: "GLOBAL_INGEST_ENDPOINT", Value: c.GlobalIngestEndpoint},
		v1.EnvVar{Name: "CONFIGS_PATH", Value: "/shared"},
		v1.EnvVar{Name: "STARTED_AT", Value: pc.startedAtOrNow()},
		v1.EnvVar{Name: "STARTED_BY", Value: startedBy},
		taskIDEnv,
	)
	if pc.needsLeaseRenewal() {
		sidecarEnv = append(sidecarEnv, v1.EnvVar{Name: "RENEW_LEASE", Value: "true"})
	}
	if pc.TaskType == "read" {
		// Read-mode behavior knobs consumed by ReadSideCar from env (mirrors
		// the legacy /read path which got them via query string).
		sidecarEnv = append(sidecarEnv,
			v1.EnvVar{Name: "NAMESPACE", Value: opts.Namespace},
			v1.EnvVar{Name: "TABLE_NAME_PREFIX", Value: opts.TableNamePrefix},
			v1.EnvVar{Name: "TO_SAME_CASE", Value: strconv.FormatBool(opts.ToSameCase)},
			v1.EnvVar{Name: "ADD_META", Value: strconv.FormatBool(opts.AddMeta)},
			v1.EnvVar{Name: "DEDUPLICATE", Value: strconv.FormatBool(opts.DeduplicateFlag())},
			v1.EnvVar{Name: "FUNCTIONS_ENV", Value: string(opts.FunctionsEnv)},
			v1.EnvVar{Name: "FULL_SYNC", Value: pc.FullSync},
		)
		// Optional AWS credentials passthrough (kept from the legacy reactive
		// path — some destinations rely on it).
		if v := envOrEmpty("AWS_ACCESS_KEY_ID"); v != "" {
			sidecarEnv = append(sidecarEnv, v1.EnvVar{Name: "AWS_ACCESS_KEY_ID", Value: v})
		}
		if v := envOrEmpty("AWS_SECRET_ACCESS_KEY"); v != "" {
			sidecarEnv = append(sidecarEnv, v1.EnvVar{Name: "AWS_SECRET_ACCESS_KEY", Value: v})
		}
		if v := envOrEmpty("AWS_DEFAULT_REGION"); v != "" {
			sidecarEnv = append(sidecarEnv, v1.EnvVar{Name: "AWS_DEFAULT_REGION", Value: v})
		}
	}
	if c.ClickhouseURL != "" || c.ClickhouseHost != "" {
		if c.ClickhouseURL != "" {
			sidecarEnv = append(sidecarEnv, v1.EnvVar{Name: "CLICKHOUSE_URL", Value: c.ClickhouseURL})
		}
		if c.ClickhouseHost != "" {
			sidecarEnv = append(sidecarEnv, v1.EnvVar{Name: "CLICKHOUSE_HOST", Value: c.ClickhouseHost})
		}
		sidecarEnv = append(sidecarEnv,
			v1.EnvVar{Name: "CLICKHOUSE_DATABASE", Value: c.ClickhouseDatabase},
			v1.EnvVar{Name: "CLICKHOUSE_USERNAME", Value: c.ClickhouseUsername},
			v1.EnvVar{Name: "CLICKHOUSE_PASSWORD", Value: c.ClickhousePassword},
			v1.EnvVar{Name: "CLICKHOUSE_SSL", Value: fmt.Sprintf("%t", c.ClickhouseSSL)},
		)
	}

	taskDescriptor := pc.taskDescriptor()
	annotations := taskDescriptor.ExtractAnnotations()

	appLabel := manualPodAppValue
	if pc.Cron {
		appLabel = cronJobAppValue
	}

	labels := map[string]string{
		k8sCreatorLabel:  k8sCreatorLabelValue,
		labelManagedBy:   managedByValue,
		labelAppName:     appLabel,
	}
	if syncID != "" {
		labels[labelSyncID] = syncID
	}
	if workspaceID != "" {
		labels[labelWorkspaceID] = workspaceID
	}

	volumes := []v1.Volume{
		{Name: "shared", VolumeSource: v1.VolumeSource{EmptyDir: &v1.EmptyDirVolumeSource{}}},
		{Name: "pipes", VolumeSource: v1.VolumeSource{EmptyDir: &v1.EmptyDirVolumeSource{}}},
	}
	if pc.needsConfigSecret() && secretName != "" {
		volumes = append(volumes, v1.Volume{
			Name:         "config",
			VolumeSource: v1.VolumeSource{Secret: &v1.SecretVolumeSource{SecretName: secretName}},
		})
	}

	// Containers: spec/check/discover use the source connector for the actual
	// task; read uses the source connector for streaming records via pipes.
	// In all cases the sidecar reads pipes and persists results.
	sourceVolumeMounts := []v1.VolumeMount{sharedMount, pipesMount}
	sidecarVolumeMounts := []v1.VolumeMount{sharedMount, pipesMount}

	containers := []v1.Container{
		{
			Name:    "source",
			Image:   sourceImage,
			Command: []string{"sh", "-c", pc.sourceCommand()},
			Env: []v1.EnvVar{
				{Name: "USE_STREAM_CAPABLE_STATE", Value: "true"},
				{Name: "AUTO_DETECT_SCHEMA", Value: "true"},
				{Name: "JAVA_OPTS", Value: "-Xmx7000m"},
			},
			VolumeMounts: sourceVolumeMounts,
			Resources:    sourceResources(),
		},
		{
			Name:            "sidecar",
			Image:           c.SidecarImage,
			ImagePullPolicy: v1.PullAlways,
			Env:             sidecarEnv,
			VolumeMounts:    sidecarVolumeMounts,
			Resources:       sidecarResources(),
		},
	}

	return v1.PodTemplateSpec{
		ObjectMeta: metav1.ObjectMeta{
			Labels:      labels,
			Annotations: annotations,
		},
		Spec: v1.PodSpec{
			RestartPolicy:                 v1.RestartPolicyNever,
			ShareProcessNamespace:         ptr.To(true),
			TerminationGracePeriodSeconds: ptr.To(int64(c.ContainerGraceShutdownSeconds)),
			ServiceAccountName:            c.PodsServiceAccount,
			NodeSelector:                  parseNodeSelector(c.KubernetesNodeSelector),
			InitContainers:                initContainers,
			Containers:                    containers,
			Volumes:                       volumes,
		},
	}
}

// taskDescriptor projects the PodCtx into a TaskDescriptor that
// ExtractAnnotations() can serialize. Used to annotate the Pod so
// watchPodStatuses can correlate pod events to (syncId/taskId/package/…).
func (c *PodCtx) taskDescriptor() TaskDescriptor {
	opts := c.Options()
	pkg, ver, storageKey := c.PackageRef()
	td := TaskDescriptor{
		TaskType:        c.TaskType,
		WorkspaceId:     c.WorkspaceID,
		SyncID:          c.SyncID,
		TaskID:          c.TaskID,
		StorageKey:      storageKey,
		Package:         pkg,
		PackageVersion:  ver,
		Namespace:       opts.Namespace,
		TableNamePrefix: opts.TableNamePrefix,
		ToSameCase:      strconv.FormatBool(opts.ToSameCase),
		AddMeta:         strconv.FormatBool(opts.AddMeta),
		Deduplicate:     strconv.FormatBool(opts.DeduplicateFlag()),
		FullSync:        c.FullSync,
		Debug:           c.Debug,
		StartedBy:       c.startedByOrDefault(),
		StartedAt:       c.startedAtOrNow(),
	}
	if c.Entry != nil && td.WorkspaceId == "" {
		td.WorkspaceId = c.Entry.WorkspaceID
	}
	if c.Entry != nil && td.SyncID == "" {
		td.SyncID = c.Entry.ID
	}
	return td
}

// startedAtOrNow returns the StartedAt to stamp into TaskDescriptor
// annotations and the sidecar's STARTED_AT env. Resolution to seconds is
// enough — the watcher reads this back to populate source_task.started_at
// on FAILED rows when nothing else wrote one.
func (c *PodCtx) startedAtOrNow() string {
	return time.Now().UTC().Format(time.RFC3339)
}

// envOrEmpty mirrors job_runner's old createPod which forwarded a few
// AWS_* envs from syncctl's own environment into the sidecar. Stays out
// of Config because these are deploy-time injected, not configured.
func envOrEmpty(name string) string {
	return os.Getenv(name)
}
