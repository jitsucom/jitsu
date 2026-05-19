package main

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/hjson/hjson-go/v4"
	"github.com/jitsucom/bulker/jitsubase/appbase"
	"github.com/jitsucom/bulker/jitsubase/logging"
	"github.com/jitsucom/bulker/jitsubase/safego"
	"github.com/jitsucom/bulker/jitsubase/utils"
	batchv1 "k8s.io/api/batch/v1"
	v1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/utils/ptr"
)

// Labels syncctl uses to identify resources it owns. The reconciler treats
// any CronJob carrying labelManagedBy=managedByValue as authoritative — it
// will create / update / delete to converge them with the polled SyncsData.
const (
	labelSyncID      = "jitsu.com/sync-id"
	labelWorkspaceID = "jitsu.com/workspace-id"
	labelManagedBy   = "jitsu.com/managed-by"
	labelAppName     = "app"
	managedByValue   = "syncctl"
	cronJobAppValue  = "sync-cron"

	// Bump when the pod-template structure changes in a way `SidecarImage`
	// + `PodsServiceAccount` won't capture (init-container command paths,
	// volume layout, env scaffolding). Forces a one-shot re-patch of every
	// reconciled CronJob on the next reconcile after upgrade.
	cronTemplateRevision = 2
)

// k8sName converts a sync ID into an RFC 1123 subdomain segment safe for use
// as a CronJob/Secret metadata.name. Console-side IDs come from juava's
// randomId() (alphabet `0-9a-zA-Z`) and may contain uppercase letters, which
// K8s rejects. We lowercase and replace any other rune with `-`. Original ID
// is preserved on the `jitsu.com/sync-id` label, which is the source of truth
// for reconcile lookups.
func k8sName(syncID string) string {
	var b strings.Builder
	b.Grow(len(syncID))
	for _, r := range syncID {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '-':
			b.WriteRune(r)
		case r >= 'A' && r <= 'Z':
			b.WriteRune(r + ('a' - 'A'))
		default:
			b.WriteRune('-')
		}
	}
	return strings.Trim(b.String(), "-")
}

func cronJobName(syncID string) string    { return "sync-" + k8sName(syncID) }
func cronSecretName(syncID string) string { return "sync-" + k8sName(syncID) + "-cfg" }

// CronJobController watches a SyncsRepository and reconciles k8s CronJobs +
// per-CronJob Secrets in syncctl's namespace.
type CronJobController struct {
	appbase.Service
	config    *Config
	clientset *kubernetes.Clientset
	repo      appbase.Repository[SyncsData]
	jobRunner *JobRunner
	closed    chan struct{}
}

func NewCronJobController(ctx *Context) *CronJobController {
	return &CronJobController{
		Service:   appbase.NewServiceBase("cronjob-controller"),
		config:    ctx.config,
		clientset: ctx.jobRunner.clientset,
		repo:      ctx.syncsRepo,
		jobRunner: ctx.jobRunner,
		closed:    make(chan struct{}),
	}
}

// Start spins up the reconcile loop. Blocks until the repo is initially
// loaded, then reconciles on every change notification.
func (c *CronJobController) Start() {
	safego.Run(func() {
		c.Infof("CronJob controller started")
		// Wait for first repository load before reconciling — avoids
		// deleting all CronJobs because we briefly saw an empty SyncsData.
		for !c.repo.Loaded() {
			select {
			case <-time.After(2 * time.Second):
			case <-c.closed:
				return
			}
		}
		c.reconcile()
		for {
			select {
			case <-c.repo.ChangesChannel():
				c.reconcile()
			case <-c.closed:
				c.Infof("CronJob controller closing")
				return
			}
		}
	})
}

func (c *CronJobController) Close() error {
	close(c.closed)
	return nil
}

func (c *CronJobController) reconcile() {
	data := c.repo.GetData()
	if data == nil {
		c.Warnf("reconcile: SyncsData is nil, skipping")
		return
	}

	// Build the desired set: any sync with a non-empty schedule needs a CronJob.
	desired := make(map[string]*SyncEntry, len(data.Syncs))
	for _, s := range data.Syncs {
		if strings.TrimSpace(s.Schedule) == "" {
			continue
		}
		desired[s.ID] = s
	}

	// List currently-managed CronJobs.
	current, err := c.clientset.BatchV1().CronJobs(c.config.KubernetesNamespace).List(context.Background(), metav1.ListOptions{
		LabelSelector: fmt.Sprintf("%s=%s", labelManagedBy, managedByValue),
	})
	if err != nil {
		c.Errorf("failed to list CronJobs: %v", err)
		return
	}

	currentByID := make(map[string]*batchv1.CronJob, len(current.Items))
	for i := range current.Items {
		cj := &current.Items[i]
		syncID := cj.Labels[labelSyncID]
		if syncID == "" {
			continue
		}
		currentByID[syncID] = cj
	}

	created, updated, deleted := 0, 0, 0
	for id, entry := range desired {
		existing := currentByID[id]
		if existing == nil {
			if err := c.createCronJob(entry); err != nil {
				c.Errorf("create CronJob %s: %v", id, err)
				continue
			}
			created++
		} else {
			changed, err := c.updateCronJobIfDrifted(existing, entry)
			if err != nil {
				c.Errorf("update CronJob %s: %v", id, err)
				continue
			}
			if changed {
				updated++
			}
		}
	}
	for id := range currentByID {
		if _, ok := desired[id]; ok {
			continue
		}
		if err := c.deleteCronJob(id); err != nil {
			c.Errorf("delete CronJob %s: %v", id, err)
			continue
		}
		deleted++
	}

	c.Infof("reconcile: desired=%d current=%d created=%d updated=%d deleted=%d",
		len(desired), len(currentByID), created, updated, deleted)
}

// configHash is recorded in an annotation on each CronJob so we can detect
// drift without diffing the whole spec. A change in either the polled
// SyncEntry OR syncctl's own pod-template inputs (sidecar image, pods SA,
// template revision) produces a different hash → reconciler patches the
// CronJob + Secret. The runtime-config bits matter because a chart upgrade
// (new image / new SA / new init-container layout) otherwise leaves existing
// CronJobs pointing at the pre-upgrade template until the next SyncEntry
// edit happens to flip the hash.
//
// UpdatedAt is included as the authoritative drift marker — any edit on the
// console side (including ones that don't touch the fields below, e.g.
// stream selection inside Options) bumps it, and that alone is enough to
// trigger a re-patch. The other fields stay in the hash so changes from
// syncctl-internal upgrades (image / SA / template) still propagate even
// when UpdatedAt hasn't changed.
func (c *CronJobController) configHash(entry *SyncEntry) string {
	b, _ := json.Marshal(struct {
		UpdatedAt string          `json:"u"`
		Schedule  string          `json:"s"`
		Timezone  string          `json:"tz"`
		SrcPkg    string          `json:"sp"`
		SrcVer    string          `json:"sv"`
		SrcCfg    json.RawMessage `json:"sc"`
		DestCfg   json.RawMessage `json:"dc"`
		Options   json.RawMessage `json:"o"`
		Image     string          `json:"img"`
		PodSA     string          `json:"sa"`
		TmplRev   int             `json:"tr"`
	}{
		UpdatedAt: entry.UpdatedAt.UTC().Format(time.RFC3339Nano),
		Schedule:  entry.Schedule,
		Timezone:  entry.Timezone,
		SrcPkg:    entry.Source.Package,
		SrcVer:    entry.Source.Version,
		SrcCfg:    entry.Source.Credentials,
		DestCfg:   entry.Destination,
		Options:   entry.Options,
		Image:     c.config.SidecarImage,
		PodSA:     c.config.PodsServiceAccount,
		TmplRev:   cronTemplateRevision,
	})
	return utils.HashStringS(string(b))
}

const annotationConfigHash = "jitsu.com/config-hash"

func (c *CronJobController) createCronJob(entry *SyncEntry) error {
	if err := c.upsertSecret(entry); err != nil {
		return fmt.Errorf("upsert secret: %w", err)
	}
	cj := c.buildCronJob(entry)
	_, err := c.clientset.BatchV1().CronJobs(c.config.KubernetesNamespace).Create(context.Background(), cj, metav1.CreateOptions{})
	if err != nil {
		if errors.IsAlreadyExists(err) {
			// Race with another syncctl instance; treat as success.
			return nil
		}
		return err
	}
	c.Infof("created CronJob %s (sync %s, schedule=%q)", cronJobName(entry.ID), entry.ID, entry.Schedule)
	return nil
}

func (c *CronJobController) updateCronJobIfDrifted(existing *batchv1.CronJob, entry *SyncEntry) (bool, error) {
	desiredHash := c.configHash(entry)
	if existing.Annotations[annotationConfigHash] == desiredHash {
		return false, nil
	}
	if err := c.upsertSecret(entry); err != nil {
		return false, fmt.Errorf("upsert secret: %w", err)
	}
	desired := c.buildCronJob(entry)
	desired.ResourceVersion = existing.ResourceVersion
	_, err := c.clientset.BatchV1().CronJobs(c.config.KubernetesNamespace).Update(context.Background(), desired, metav1.UpdateOptions{})
	if err != nil {
		return false, err
	}
	c.Infof("updated CronJob %s (sync %s, schedule=%q)", cronJobName(entry.ID), entry.ID, entry.Schedule)
	return true, nil
}

func (c *CronJobController) deleteCronJob(syncID string) error {
	name := cronJobName(syncID)
	policy := metav1.DeletePropagationBackground
	err := c.clientset.BatchV1().CronJobs(c.config.KubernetesNamespace).Delete(context.Background(), name, metav1.DeleteOptions{PropagationPolicy: &policy})
	if err != nil && !errors.IsNotFound(err) {
		return err
	}
	// Best-effort delete of the per-CronJob Secret. Ignore NotFound.
	_ = c.clientset.CoreV1().Secrets(c.config.KubernetesNamespace).Delete(context.Background(), cronSecretName(syncID), metav1.DeleteOptions{})
	c.Infof("deleted CronJob %s (sync %s)", name, syncID)
	return nil
}

// upsertSecret creates or updates the per-CronJob Secret holding the source
// config.json + destinationConfig.json that the Pod's containers consume.
// File names match what sync-sidecar's ReadSideCar.loadDestinationConfig
// expects at /config/destinationConfig.json.
func (c *CronJobController) upsertSecret(entry *SyncEntry) error {
	name := cronSecretName(entry.ID)
	// /config/serviceConfig.json holds the Jitsu service config wrapper
	// (package, version, authorized, credentials). oauth-refresh init reads
	// cfg["authorized"] and cfg["credentials"] from it, then writes the
	// unwrapped airbyte config to /shared/config.json — that's the file the
	// source connector actually reads via --config. Different name here
	// avoids the impression that this Secret-mounted file is what the source
	// expects directly.
	sourceJSON, err := json.Marshal(entry.Source)
	if err != nil {
		return fmt.Errorf("marshal source config: %w", err)
	}
	data := map[string][]byte{
		"serviceConfig.json":     sourceJSON,
		"destinationConfig.json": entry.Destination,
	}
	desired := &v1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: c.config.KubernetesNamespace,
			Labels: map[string]string{
				labelManagedBy:   managedByValue,
				labelSyncID:      entry.ID,
				labelWorkspaceID: entry.WorkspaceID,
			},
		},
		Type: v1.SecretTypeOpaque,
		Data: data,
	}
	secrets := c.clientset.CoreV1().Secrets(c.config.KubernetesNamespace)

	_, err = secrets.Create(context.Background(), desired, metav1.CreateOptions{})
	if err == nil {
		return nil
	}
	if !errors.IsAlreadyExists(err) {
		return err
	}
	// Secret already exists — fetch its resourceVersion and Update with it.
	// k8s.io rejects Update without a matching resourceVersion.
	existing, getErr := secrets.Get(context.Background(), name, metav1.GetOptions{})
	if getErr != nil {
		return getErr
	}
	desired.ResourceVersion = existing.ResourceVersion
	_, err = secrets.Update(context.Background(), desired, metav1.UpdateOptions{})
	return err
}

// buildCronJob assembles the full CronJob object for a sync entry. Wraps
// buildCronPodTemplate so reconcile + tests can construct one declaratively.
func (c *CronJobController) buildCronJob(entry *SyncEntry) *batchv1.CronJob {
	startingDeadlineSeconds := int64(60) // skip a missed schedule rather than back-stack it
	successHistory := int32(1)
	failureHistory := int32(3)

	jobSpec := batchv1.JobSpec{
		BackoffLimit:          ptr.To(c.config.JobBackoffLimit),
		ActiveDeadlineSeconds: ptr.To(int64(c.config.JobActiveDeadlineSeconds)),
		Template:              c.buildCronPodTemplate(entry),
	}

	return &batchv1.CronJob{
		TypeMeta: metav1.TypeMeta{Kind: "CronJob", APIVersion: "batch/v1"},
		ObjectMeta: metav1.ObjectMeta{
			Name:      cronJobName(entry.ID),
			Namespace: c.config.KubernetesNamespace,
			Labels: map[string]string{
				labelManagedBy:   managedByValue,
				labelAppName:     cronJobAppValue,
				labelSyncID:      entry.ID,
				labelWorkspaceID: entry.WorkspaceID,
			},
			Annotations: map[string]string{
				annotationConfigHash: c.configHash(entry),
			},
		},
		Spec: batchv1.CronJobSpec{
			Schedule:                   entry.Schedule,
			TimeZone:                   ptr.To(entry.Timezone),
			ConcurrencyPolicy:          batchv1.ForbidConcurrent,
			StartingDeadlineSeconds:    &startingDeadlineSeconds,
			SuccessfulJobsHistoryLimit: &successHistory,
			FailedJobsHistoryLimit:     &failureHistory,
			JobTemplate: batchv1.JobTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{
					Labels: map[string]string{
						labelManagedBy:   managedByValue,
						labelAppName:     cronJobAppValue,
						labelSyncID:      entry.ID,
						labelWorkspaceID: entry.WorkspaceID,
					},
				},
				Spec: jobSpec,
			},
		},
	}
}

// buildCronPodTemplate builds the autonomous Pod template embedded in each
// CronJob's jobTemplate. Init container chain:
//
//	lease-acquire           — exits non-zero if Lease "<syncId>" is held
//	oauth-refresh           — always; for OAuth services calls Nango to refresh
//	                          tokens; writes /shared/config.json
//	discover (conditional)  — airbyte source `discover` against
//	                          /shared/config.json; output to /shared/discover.jsonl
//	load-catalog-state      — parses /shared/discover.jsonl (if present) into source_catalog,
//	                          then reads source_catalog + source_state from DB,
//	                          applies selectStreamsFromCatalog using OPTIONS_JSON,
//	                          writes /shared/catalog.json + /shared/state.json
//	pipes-init              — creates fifos for source ↔ sidecar streaming
//
// Main containers: source (airbyte read against /shared/config.json) + sidecar
// (existing default mode + lease-renewal goroutine; SIGTERMs source via
// shareProcessNamespace if it loses the lease).
func (c *CronJobController) buildCronPodTemplate(entry *SyncEntry) v1.PodTemplateSpec {
	// Run-time options pulled from sync.data — must match what
	// ReadSideCar consumes via env in bulker/sync-sidecar/main.go.
	var opts struct {
		SchemaChanges   string          `json:"schemaChanges"`
		VersionHash     string          `json:"versionHash"`
		Namespace       string          `json:"namespace"`
		TableNamePrefix string          `json:"tableNamePrefix"`
		ToSameCase      bool            `json:"toSameCase"`
		AddMeta         bool            `json:"addMeta"`
		Deduplicate     *bool           `json:"deduplicate"`
		FunctionsEnv    json.RawMessage `json:"functionsEnv"`
	}
	_ = json.Unmarshal(entry.Options, &opts)
	needsDiscover := opts.SchemaChanges == "fields" || opts.SchemaChanges == "streams"
	// scheduleSync defaults deduplicate=true when missing.
	deduplicate := true
	if opts.Deduplicate != nil {
		deduplicate = *opts.Deduplicate
	}

	sourceImage := fmt.Sprintf("%s:%s", entry.Source.Package, entry.Source.Version)
	configSecretName := cronSecretName(entry.ID)
	databaseURL := utils.NvlString(c.config.SidecarDatabaseURL, c.config.DatabaseURL)

	configMount := v1.VolumeMount{Name: "config", MountPath: "/config"}
	sharedMount := v1.VolumeMount{Name: "shared", MountPath: "/shared"}
	pipesMount := v1.VolumeMount{Name: "pipes", MountPath: "/pipes"}

	// Env shared by every sync-sidecar invocation in the Pod (init + main).
	baseEnv := []v1.EnvVar{
		{Name: "SYNC_ID", Value: entry.ID},
		{Name: "WORKSPACE_ID", Value: entry.WorkspaceID},
		{Name: "FROM_ID", Value: entry.FromID},
		{Name: "PACKAGE", Value: entry.Source.Package},
		{Name: "PACKAGE_VERSION", Value: entry.Source.Version},
		{Name: "STORAGE_KEY", Value: opts.VersionHash},
		{Name: "DATABASE_URL", Value: databaseURL},
		{Name: "KUBE_NAMESPACE", Value: c.config.KubernetesNamespace},
		{Name: "POD_NAME", ValueFrom: &v1.EnvVarSource{FieldRef: &v1.ObjectFieldSelector{FieldPath: "metadata.name"}}},
		{Name: "LOG_LEVEL", Value: c.config.LogLevel},
		{Name: "DB_LOG_LEVEL", Value: c.config.DBLogLevel},
	}

	initContainers := []v1.Container{
		{
			Name:      "lease-acquire",
			Image:     c.config.SidecarImage,
			Command:   []string{"/app/sidecar", "lease-acquire"},
			Env:       baseEnv,
			Resources: smallResources(),
		},
	}

	// oauth-refresh: always runs. Reads /config/serviceConfig.json (the
	// Jitsu wrapper), unwraps `credentials` and writes the airbyte config to
	// /shared/config.json. For OAuth-authorized services it first calls
	// Nango to refresh access tokens so the source connector doesn't fail
	// with stale tokens.
	oauthEnv := append([]v1.EnvVar{}, baseEnv...)
	oauthEnv = append(oauthEnv,
		v1.EnvVar{Name: "NANGO_API_HOST", Value: c.config.NangoAPIHost},
		v1.EnvVar{Name: "NANGO_SECRET_KEY", Value: c.config.NangoSecretKey},
		v1.EnvVar{Name: "GOOGLE_ADS_DEVELOPER_TOKEN", Value: c.config.GoogleAdsDeveloperToken},
	)
	initContainers = append(initContainers, v1.Container{
		Name:         "oauth-refresh",
		Image:        c.config.SidecarImage,
		Command:      []string{"/app/sidecar", "oauth-refresh"},
		Env:          oauthEnv,
		VolumeMounts: []v1.VolumeMount{configMount, sharedMount},
		Resources:    smallResources(),
	})

	if needsDiscover {
		// Run airbyte source `discover` against the OAuth-refreshed config in
		// /shared. Capture mixed JSONL output to /shared/discover.jsonl for
		// the load-catalog-state init to parse.
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

	loadEnv := append([]v1.EnvVar{}, baseEnv...)
	loadEnv = append(loadEnv,
		v1.EnvVar{Name: "OPTIONS_JSON", Value: string(entry.Options)},
	)
	initContainers = append(initContainers, v1.Container{
		Name:         "load-catalog-state",
		Image:        c.config.SidecarImage,
		Command:      []string{"/app/sidecar", "load-catalog-state"},
		Env:          loadEnv,
		VolumeMounts: []v1.VolumeMount{configMount, sharedMount},
		Resources:    smallResources(),
	})

	initContainers = append(initContainers, v1.Container{
		Name:         "pipes-init",
		Image:        "alpine",
		Command:      []string{"sh", "-c", "mkfifo /pipes/stdout; mkfifo /pipes/stderr; chmod 777 /pipes/*"},
		VolumeMounts: []v1.VolumeMount{pipesMount},
		Resources:    smallResources(),
	})

	sidecarEnv := append([]v1.EnvVar{}, baseEnv...)
	sidecarEnv = append(sidecarEnv,
		v1.EnvVar{Name: "STDOUT_PIPE_FILE", Value: "/pipes/stdout"},
		v1.EnvVar{Name: "STDERR_PIPE_FILE", Value: "/pipes/stderr"},
		v1.EnvVar{Name: "COMMAND", Value: "read"},
		v1.EnvVar{Name: "TASK_TIMEOUT_HOURS", Value: strconv.Itoa(c.config.TaskTimeoutHours)},
		v1.EnvVar{Name: "LOCAL_INGEST_ENDPOINT", Value: c.config.LocalIngestEndpoint},
		v1.EnvVar{Name: "GLOBAL_INGEST_ENDPOINT", Value: c.config.GlobalIngestEndpoint},
		v1.EnvVar{Name: "RENEW_LEASE", Value: "true"},
		// All sidecar inputs (catalog.json, state.json, destinationConfig.json)
		// live in /shared in the autonomous flow:
		//   - destinationConfig.json — copied from /config by oauth-refresh init
		//   - catalog.json + state.json — written by load-catalog-state init
		// Source connector reads /shared/config.json directly via --config.
		// ReadSideCar.configsPath() resolves all three paths from this env.
		v1.EnvVar{Name: "CONFIGS_PATH", Value: "/shared"},
		// Sync behavior options consumed by ReadSideCar from env (mirroring
		// the legacy /read path which gets these via query string from
		// scheduleSync). Without them, scheduled runs would silently fall
		// back to defaults — different namespacing, dedupe, etc.
		v1.EnvVar{Name: "NAMESPACE", Value: opts.Namespace},
		v1.EnvVar{Name: "TABLE_NAME_PREFIX", Value: opts.TableNamePrefix},
		v1.EnvVar{Name: "TO_SAME_CASE", Value: strconv.FormatBool(opts.ToSameCase)},
		v1.EnvVar{Name: "ADD_META", Value: strconv.FormatBool(opts.AddMeta)},
		v1.EnvVar{Name: "DEDUPLICATE", Value: strconv.FormatBool(deduplicate)},
		v1.EnvVar{Name: "FUNCTIONS_ENV", Value: string(opts.FunctionsEnv)},
		// One TASK_ID per Job run. Pod name is unique-per-run since k8s
		// embeds the Job name + a random suffix; reusing it here gives the
		// sidecar a stable correlation ID for logs / source_task / clickhouse.
		v1.EnvVar{Name: "TASK_ID", ValueFrom: &v1.EnvVarSource{FieldRef: &v1.ObjectFieldSelector{FieldPath: "metadata.name"}}},
	)

	// TaskDescriptor annotations let job_runner.watchPodStatuses observe cron
	// pod failures the same way it observes ad-hoc Job pods. taskId/startedAt
	// are intentionally empty here — they're per-fire, derived from pod name
	// / pod.Status.StartTime by the watcher. The `creator` label is what the
	// watcher's selector matches; without it, an init container failure
	// (e.g. discover blowing up on a bad config) would be invisible to
	// task_manager and no source_task FAILED row would be written.
	cronTaskDescriptor := TaskDescriptor{
		TaskType:        "read",
		WorkspaceId:     entry.WorkspaceID,
		SyncID:          entry.ID,
		StorageKey:      opts.VersionHash,
		Package:         entry.Source.Package,
		PackageVersion:  entry.Source.Version,
		Namespace:       opts.Namespace,
		TableNamePrefix: opts.TableNamePrefix,
		ToSameCase:      strconv.FormatBool(opts.ToSameCase),
		AddMeta:         strconv.FormatBool(opts.AddMeta),
		Deduplicate:     strconv.FormatBool(deduplicate),
		StartedBy:       `{"type":"scheduled"}`,
	}

	pod := v1.PodTemplateSpec{
		ObjectMeta: metav1.ObjectMeta{
			Labels: map[string]string{
				k8sCreatorLabel:  k8sCreatorLabelValue,
				labelManagedBy:   managedByValue,
				labelAppName:     cronJobAppValue,
				labelSyncID:      entry.ID,
				labelWorkspaceID: entry.WorkspaceID,
			},
			Annotations: cronTaskDescriptor.ExtractAnnotations(),
		},
		Spec: v1.PodSpec{
			RestartPolicy:                 v1.RestartPolicyNever,
			ShareProcessNamespace:         ptr.To(true),
			TerminationGracePeriodSeconds: ptr.To(int64(c.config.ContainerGraceShutdownSeconds)),
			ServiceAccountName:            c.config.PodsServiceAccount,
			NodeSelector:                  parseNodeSelector(c.config.KubernetesNodeSelector),
			InitContainers:                initContainers,
			Containers: []v1.Container{
				{
					Name:    "source",
					Image:   sourceImage,
					Command: []string{"sh", "-c", `eval "$AIRBYTE_ENTRYPOINT read --config /shared/config.json --catalog /shared/catalog.json --state /shared/state.json" 2> /pipes/stderr > /pipes/stdout`},
					Env: []v1.EnvVar{
						{Name: "USE_STREAM_CAPABLE_STATE", Value: "true"},
						{Name: "AUTO_DETECT_SCHEMA", Value: "true"},
						{Name: "JAVA_OPTS", Value: "-Xmx7000m"},
					},
					VolumeMounts: []v1.VolumeMount{sharedMount, pipesMount},
					Resources:    sourceResources(),
				},
				{
					Name:            "sidecar",
					Image:           c.config.SidecarImage,
					ImagePullPolicy: v1.PullAlways,
					Env:             sidecarEnv,
					// Sidecar reads everything (catalog, state, destinationConfig)
					// from /shared via CONFIGS_PATH — no need for the /config
					// Secret mount in autonomous mode.
					VolumeMounts: []v1.VolumeMount{sharedMount, pipesMount},
					Resources:    sidecarResources(),
				},
			},
			Volumes: []v1.Volume{
				{Name: "config", VolumeSource: v1.VolumeSource{Secret: &v1.SecretVolumeSource{SecretName: configSecretName}}},
				{Name: "shared", VolumeSource: v1.VolumeSource{EmptyDir: &v1.EmptyDirVolumeSource{}}},
				{Name: "pipes", VolumeSource: v1.VolumeSource{EmptyDir: &v1.EmptyDirVolumeSource{}}},
			},
		},
	}
	return pod
}

func parseNodeSelector(raw string) map[string]string {
	if raw == "" {
		return nil
	}
	out := map[string]string{}
	if err := hjson.Unmarshal([]byte(raw), &out); err != nil {
		logging.Errorf("[cronjob-controller] invalid KUBERNETES_NODE_SELECTOR=%q, ignoring: %v", raw, err)
		return nil
	}
	return out
}

func sourceResources() v1.ResourceRequirements {
	return v1.ResourceRequirements{
		Limits: v1.ResourceList{
			v1.ResourceCPU:    *resource.NewMilliQuantity(int64(1000), resource.DecimalSI),
			v1.ResourceMemory: *resource.NewQuantity(int64(math.Pow(2, 33)), resource.BinarySI), // 8Gi
		},
		Requests: v1.ResourceList{
			v1.ResourceCPU:    *resource.NewMilliQuantity(int64(100), resource.DecimalSI),
			v1.ResourceMemory: *resource.NewQuantity(int64(math.Pow(2, 28)), resource.BinarySI), // 256Mi
		},
	}
}

func sidecarResources() v1.ResourceRequirements {
	return v1.ResourceRequirements{
		Limits: v1.ResourceList{
			v1.ResourceCPU:    *resource.NewMilliQuantity(int64(500), resource.DecimalSI),
			v1.ResourceMemory: *resource.NewQuantity(int64(math.Pow(2, 32)), resource.BinarySI), // 4Gi
		},
	}
}

func smallResources() v1.ResourceRequirements {
	return v1.ResourceRequirements{
		Limits: v1.ResourceList{
			v1.ResourceCPU:    *resource.NewMilliQuantity(int64(200), resource.DecimalSI),
			v1.ResourceMemory: *resource.NewQuantity(int64(math.Pow(2, 28)), resource.BinarySI), // 256Mi
		},
	}
}
