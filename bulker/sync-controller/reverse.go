package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"regexp"
	"time"

	v1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/utils/ptr"
)

const labelSyncKind = "jitsu.com/sync-kind"

var reverseID = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,128}$`)
var reverseRevision = regexp.MustCompile(`^[a-f0-9]{64}$`)

// Versioned console contract. Preserve raw model/options/config payloads in Secrets.
type ReverseConfig struct {
	Version        int             `json:"version"`
	Kind           string          `json:"kind"`
	ID             string          `json:"id"`
	WorkspaceID    string          `json:"workspaceId"`
	FromID         string          `json:"fromId"`
	ToID           string          `json:"toId"`
	ConfigRevision string          `json:"configRevision"`
	UpdatedAt      time.Time       `json:"updatedAt"`
	Schedule       string          `json:"schedule,omitempty"`
	Timezone       string          `json:"timezone"`
	Model          json.RawMessage `json:"model"`
	Warehouse      json.RawMessage `json:"warehouse"`
	Destination    json.RawMessage `json:"destination"`
	Options        json.RawMessage `json:"options"`
}

func (r *ReverseConfig) valid() bool {
	return r.Version == 1 && r.Kind == "reverse" && reverseID.MatchString(r.ID) && r.WorkspaceID != "" && reverseRevision.MatchString(r.ConfigRevision) && !r.UpdatedAt.IsZero() && len(r.Model) > 0 && len(r.Warehouse) > 0 && len(r.Options) > 0
}
func (r *ReverseConfig) entry() *SyncEntry {
	schedule := r.Schedule
	if r.paused() {
		schedule = ""
	}
	return &SyncEntry{ID: r.ID, WorkspaceID: r.WorkspaceID, FromID: r.FromID, ToID: r.ToID, Schedule: schedule, Timezone: r.Timezone, UpdatedAt: r.UpdatedAt, Reverse: r}
}

func (r *ReverseConfig) paused() bool {
	var options struct {
		Disabled bool `json:"disabled"`
	}
	return json.Unmarshal(r.Options, &options) != nil || options.Disabled
}

// Shared with retl-runner/src/lease.ts. Hash preserves case and avoids name collisions.
func reverseResourceName(id string) string {
	hash := sha256.Sum256([]byte(id))
	return "reverse-" + hex.EncodeToString(hash[:])[:32]
}

func buildReversePodTemplate(c *Config, entry *SyncEntry, secret, taskID string) v1.PodTemplateSpec {
	settings := c.reverseSettings()
	trigger := "scheduled"
	taskEnv := v1.EnvVar{Name: "TASK_ID", ValueFrom: &v1.EnvVarSource{FieldRef: &v1.ObjectFieldSelector{FieldPath: "metadata.name"}}}
	if taskID != "" {
		trigger = "manual"
		taskEnv = v1.EnvVar{Name: "TASK_ID", Value: taskID}
	}
	td := TaskDescriptor{TaskID: taskID, TaskType: "reverse", SyncID: entry.ID, WorkspaceId: entry.WorkspaceID, Package: "jitsu/retl-runner", PackageVersion: "1", StartedBy: `{"trigger":"` + trigger + `","kind":"reverse"}`}
	env := []v1.EnvVar{taskEnv, {Name: "RETL_TRIGGER", Value: trigger},
		{Name: "POD_NAME", ValueFrom: &v1.EnvVarSource{FieldRef: &v1.ObjectFieldSelector{FieldPath: "metadata.name"}}},
		{Name: "POD_UID", ValueFrom: &v1.EnvVarSource{FieldRef: &v1.ObjectFieldSelector{FieldPath: "metadata.uid"}}},
		{Name: "KUBE_NAMESPACE", ValueFrom: &v1.EnvVarSource{FieldRef: &v1.ObjectFieldSelector{FieldPath: "metadata.namespace"}}},
	}
	for _, key := range []string{"RETL_DATABASE_URL", "RETL_CONSOLE_URL", "RETL_CONSOLE_TOKEN", "RETL_OBJECT_STORE", "RETL_OBJECT_BUCKET"} {
		env = append(env, v1.EnvVar{Name: key, ValueFrom: &v1.EnvVarSource{SecretKeyRef: &v1.SecretKeySelector{LocalObjectReference: v1.LocalObjectReference{Name: c.ReverseRuntimeSecret}, Key: key}}})
	}
	// Optional runtime configuration: object storage and provider-level credential fallback.
	// The Ads token is unnecessary for Data Manager streams or destinations with their own token.
	for _, key := range []string{"RETL_OBJECT_PREFIX", "RETL_S3_ENDPOINT", "RETL_S3_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "GOOGLE_ADS_DEVELOPER_TOKEN"} {
		env = append(env, v1.EnvVar{Name: key, ValueFrom: &v1.EnvVarSource{SecretKeyRef: &v1.SecretKeySelector{LocalObjectReference: v1.LocalObjectReference{Name: c.ReverseRuntimeSecret}, Key: key, Optional: ptr.To(true)}}})
	}
	return v1.PodTemplateSpec{ObjectMeta: metav1.ObjectMeta{Labels: map[string]string{k8sCreatorLabel: k8sCreatorLabelValue, labelManagedBy: managedByValue, labelSyncID: entry.ID, labelWorkspaceID: entry.WorkspaceID, labelSyncKind: "reverse", labelAppName: cronJobAppValue}, Annotations: td.ExtractAnnotations()}, Spec: v1.PodSpec{
		RestartPolicy: v1.RestartPolicyNever, ServiceAccountName: c.reverseServiceAccount(), TerminationGracePeriodSeconds: ptr.To(int64(60)),
		NodeSelector: parseNodeSelector(c.KubernetesNodeSelector),
		Containers: []v1.Container{{Name: "retl-runner", Image: c.ReverseRunnerImage, Env: env, Resources: *settings.resources.DeepCopy(),
			SecurityContext: &v1.SecurityContext{AllowPrivilegeEscalation: ptr.To(false), RunAsNonRoot: ptr.To(true), RunAsUser: ptr.To(int64(1000)), ReadOnlyRootFilesystem: ptr.To(true), Capabilities: &v1.Capabilities{Drop: []v1.Capability{"ALL"}}},
			VolumeMounts:    []v1.VolumeMount{{Name: "config", MountPath: "/config", ReadOnly: true}, {Name: "tmp", MountPath: "/tmp"}},
		}},
		Volumes: []v1.Volume{{Name: "config", VolumeSource: v1.VolumeSource{Secret: &v1.SecretVolumeSource{SecretName: secret}}}, {Name: "tmp", VolumeSource: v1.VolumeSource{EmptyDir: &v1.EmptyDirVolumeSource{SizeLimit: ptr.To(settings.scratch.DeepCopy())}}}},
	}}
}
