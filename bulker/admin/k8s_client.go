package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/hjson/hjson-go/v4"
	"github.com/jitsucom/bulker/jitsubase/utils"
	batchv1 "k8s.io/api/batch/v1"
	v1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/utils/ptr"
)

// K8sJobClient handles Kubernetes Job operations
type K8sJobClient struct {
	clientset *kubernetes.Clientset
	namespace string
	config    *Config
}

func GetK8SClientSet(cfg *Config) (*kubernetes.Clientset, *rest.Config, error) {
	config := cfg.KubernetesClientConfig
	if config == "" || config == "local" {
		// creates the in-cluster config
		cc, err := rest.InClusterConfig()
		if err != nil {
			return nil, nil, fmt.Errorf("error getting in cluster config: %v", err)
		}
		clientset, err := kubernetes.NewForConfig(cc)
		if err != nil {
			return nil, nil, fmt.Errorf("error creating kubernetes clientset: %v", err)
		}
		return clientset, cc, nil
	} else if strings.ContainsRune(config, '\n') {
		// suppose yaml file
		clientconfig, err := clientcmd.NewClientConfigFromBytes([]byte(config))
		if err != nil {
			return nil, nil, fmt.Errorf("error parsing kubernetes client config: %v", err)
		}
		rawConfig, _ := clientconfig.RawConfig()
		clientconfig = clientcmd.NewNonInteractiveClientConfig(rawConfig,
			utils.NvlString(cfg.KubernetesContext, rawConfig.CurrentContext),
			&clientcmd.ConfigOverrides{},
			&clientcmd.ClientConfigLoadingRules{})
		cc, err := clientconfig.ClientConfig()
		if err != nil {
			return nil, nil, fmt.Errorf("error creating kubernetes client config: %v", err)
		}
		clientset, err := kubernetes.NewForConfig(cc)
		if err != nil {
			return nil, nil, fmt.Errorf("error creating kubernetes clientset: %v", err)
		}
		return clientset, cc, nil
	} else {
		// suppose kubeconfig file path
		clientconfig := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(
			&clientcmd.ClientConfigLoadingRules{ExplicitPath: config},
			&clientcmd.ConfigOverrides{
				CurrentContext: cfg.KubernetesContext,
			})
		cc, err := clientconfig.ClientConfig()
		if err != nil {
			return nil, nil, fmt.Errorf("error creating kubernetes client config: %v", err)
		}
		clientset, err := kubernetes.NewForConfig(cc)
		if err != nil {
			return nil, nil, fmt.Errorf("error creating kubernetes clientset: %v", err)
		}
		return clientset, cc, nil
	}
}

// NewK8sJobClient creates a new K8s job client
func NewK8sJobClient(config *Config) (*K8sJobClient, error) {
	var err error

	clientset, _, err := GetK8SClientSet(config)
	if err != nil {
		return nil, fmt.Errorf("failed to create kubernetes clientset: %w", err)
	}

	namespace := config.KubernetesNamespace
	if namespace == "" {
		namespace = "default"
	}

	return &K8sJobClient{
		clientset: clientset,
		namespace: namespace,
		config:    config,
	}, nil
}

// FileItem represents a file to be processed with its metadata
type FileItem struct {
	Path         string    `json:"path"`
	Size         int64     `json:"size"`
	LastModified time.Time `json:"last_modified,omitempty"`
}

// CreateReprocessingJob creates a Kubernetes Indexed Job for reprocessing
func (k *K8sJobClient) CreateReprocessingJob(ctx context.Context, jobID string, files []FileItem, jobConfig ReprocessingJobConfig, workerCount int) (string, error) {
	// Create ConfigMap with file list
	filesConfigMapName := fmt.Sprintf("reprocess-%s-files", jobID)
	err := k.createFileListConfigMap(ctx, filesConfigMapName, files, workerCount)
	if err != nil {
		return "", fmt.Errorf("failed to create files configmap: %w", err)
	}

	// Create ConfigMap with job configuration
	jobConfigMapName := fmt.Sprintf("reprocess-%s-config", jobID)
	err = k.createJobConfigMap(ctx, jobConfigMapName, jobConfig)
	if err != nil {
		return "", fmt.Errorf("failed to create job config configmap: %w", err)
	}

	// Create Secret with credentials
	secretName := fmt.Sprintf("reprocess-%s-credentials", jobID)
	err = k.createCredentialsSecret(ctx, secretName)
	if err != nil {
		return "", fmt.Errorf("failed to create credentials secret: %w", err)
	}

	// Create the Indexed Job
	jobName := fmt.Sprintf("reprocess-%s", jobID)
	job := k.buildIndexedJob(jobName, filesConfigMapName, jobConfigMapName, secretName, jobID, workerCount, jobConfig.ParallelWorkers)

	createdJob, err := k.clientset.BatchV1().Jobs(k.namespace).Create(ctx, job, metav1.CreateOptions{})
	if err != nil {
		return "", fmt.Errorf("failed to create job: %w", err)
	}

	return createdJob.Name, nil
}

func gzipCompress(data []byte) ([]byte, error) {
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	if _, err := gz.Write(data); err != nil {
		return nil, err
	}
	if err := gz.Close(); err != nil { // important — flush and close
		return nil, err
	}
	return buf.Bytes(), nil
}

// createFileListConfigMap creates a ConfigMap containing the list of files to process
func (k *K8sJobClient) createFileListConfigMap(ctx context.Context, name string, files []FileItem, workerCount int) error {
	filesJSON, err := json.Marshal(files)
	if err != nil {
		return fmt.Errorf("failed to marshal files: %w", err)
	}
	//compress
	gzipFilesJSON, err := gzipCompress(filesJSON)
	if err != nil {
		return fmt.Errorf("failed to gzip files json: %w", err)
	}

	configMap := &v1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: k.namespace,
			Labels: map[string]string{
				"app":  "bulker-reprocessing",
				"type": "file-list",
			},
		},
		BinaryData: map[string][]byte{
			"files.json": gzipFilesJSON,
		},
		Data: map[string]string{
			"worker_count": fmt.Sprintf("%d", workerCount),
			"total_files":  fmt.Sprintf("%d", len(files)),
		},
	}

	_, err = k.clientset.CoreV1().ConfigMaps(k.namespace).Create(ctx, configMap, metav1.CreateOptions{})
	return err
}

// createJobConfigMap creates a ConfigMap containing the job configuration
func (k *K8sJobClient) createJobConfigMap(ctx context.Context, name string, jobConfig ReprocessingJobConfig) error {
	configJSON, err := json.Marshal(jobConfig)
	if err != nil {
		return fmt.Errorf("failed to marshal job config: %w", err)
	}

	configMap := &v1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: k.namespace,
			Labels: map[string]string{
				"app":  "bulker-reprocessing",
				"type": "job-config",
			},
		},
		Data: map[string]string{
			"config.json": string(configJSON),
		},
	}

	_, err = k.clientset.CoreV1().ConfigMaps(k.namespace).Create(ctx, configMap, metav1.CreateOptions{})
	return err
}

// createCredentialsSecret creates a Secret containing infrastructure credentials
func (k *K8sJobClient) createCredentialsSecret(ctx context.Context, name string) error {
	secret := &v1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: k.namespace,
			Labels: map[string]string{
				"app":  "bulker-reprocessing",
				"type": "credentials",
			},
		},
		StringData: map[string]string{
			"DATABASE_URL":             k.config.DatabaseURL,
			"KAFKA_BOOTSTRAP_SERVERS":  utils.DefaultString(k.config.WorkerKafkaBootstrapServers, k.config.KafkaBootstrapServers),
			"KAFKA_DESTINATIONS_TOPIC": k.config.KafkaDestinationsTopicName,
			"REPOSITORY_URL":           k.config.RepositoryURL,
			"REPOSITORY_AUTH_TOKEN":    k.config.RepositoryAuthToken,
		},
	}

	// Add AWS credentials from environment if available
	awsAccessKeyID := os.Getenv("AWS_ACCESS_KEY_ID")
	awsSecretAccessKey := os.Getenv("AWS_SECRET_ACCESS_KEY")
	awsDefaultRegion := os.Getenv("AWS_DEFAULT_REGION")

	if awsAccessKeyID != "" {
		secret.StringData["AWS_ACCESS_KEY_ID"] = awsAccessKeyID
	}
	if awsSecretAccessKey != "" {
		secret.StringData["AWS_SECRET_ACCESS_KEY"] = awsSecretAccessKey
	}
	if awsDefaultRegion != "" {
		secret.StringData["AWS_DEFAULT_REGION"] = awsDefaultRegion
	}

	_, err := k.clientset.CoreV1().Secrets(k.namespace).Create(ctx, secret, metav1.CreateOptions{})
	return err
}

// buildIndexedJob builds the Kubernetes Job specification
func (k *K8sJobClient) buildIndexedJob(jobName, filesConfigMapName, jobConfigMapName, secretName, jobID string, completions, parallelWorkers int) *batchv1.Job {
	// Per-job setting wins; the K8S_MAX_PARALLEL_WORKERS env cap is the
	// fallback for jobs that don't specify one.
	parallelism := completions
	if parallelWorkers > 0 {
		if parallelism > parallelWorkers {
			parallelism = parallelWorkers
		}
	} else if k.config.K8sMaxParallelWorkers > 0 && parallelism > k.config.K8sMaxParallelWorkers {
		parallelism = k.config.K8sMaxParallelWorkers
	}

	// Parse node selector from config if provided
	var nodeSelector map[string]string
	if k.config.KubernetesNodeSelector != "" {
		nodeSelector = map[string]string{}
		err := hjson.Unmarshal([]byte(k.config.KubernetesNodeSelector), &nodeSelector)
		if err != nil {
			fmt.Printf("WARNING: failed to parse node selector from string: %s\nIgnoring it. Error: %v\n", k.config.KubernetesNodeSelector, err)
			nodeSelector = nil
		}
	}

	job := &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{
			Name:      jobName,
			Namespace: k.namespace,
			Labels: map[string]string{
				"app":    "bulker-reprocessing",
				"job-id": jobID,
			},
		},
		Spec: batchv1.JobSpec{
			Completions:             ptr.To(int32(completions)),
			Parallelism:             ptr.To(int32(parallelism)),
			CompletionMode:          (*batchv1.CompletionMode)(ptr.To(string(batchv1.IndexedCompletion))),
			BackoffLimit:            ptr.To(int32(3)),
			TTLSecondsAfterFinished: ptr.To(int32(86400)), // Clean up after 24 hours
			Template: v1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{
					Labels: map[string]string{
						"app":    "bulker-reprocessing",
						"job-id": jobID,
					},
				},

				Spec: v1.PodSpec{
					RestartPolicy: v1.RestartPolicyOnFailure,
					NodeSelector:  nodeSelector,
					Tolerations: []v1.Toleration{
						{
							Operator: v1.TolerationOpEqual,
							Key:      "kubernetes.io/arch",
							Value:    "arm64",
							Effect:   v1.TaintEffectNoSchedule,
						},
					},
					Containers: []v1.Container{
						{
							Name:  "worker",
							Image: k.config.ReprocessingWorkerImage,
							Env: []v1.EnvVar{
								{
									Name:  "JOB_ID",
									Value: jobID,
								},
								{
									Name: "WORKER_INDEX",
									ValueFrom: &v1.EnvVarSource{
										FieldRef: &v1.ObjectFieldSelector{
											FieldPath: "metadata.annotations['batch.kubernetes.io/job-completion-index']",
										},
									},
								},
								{
									Name:  "TOTAL_WORKERS",
									Value: fmt.Sprintf("%d", completions),
								},
							},
							EnvFrom: []v1.EnvFromSource{
								{
									SecretRef: &v1.SecretEnvSource{
										LocalObjectReference: v1.LocalObjectReference{
											Name: secretName,
										},
									},
								},
							},
							Resources: v1.ResourceRequirements{
								Limits: v1.ResourceList{
									v1.ResourceCPU:    *resource.NewMilliQuantity(int64(1000), resource.DecimalSI),
									v1.ResourceMemory: *resource.NewQuantity(int64(math.Pow(2, 31)), resource.BinarySI),
								},
								Requests: v1.ResourceList{
									v1.ResourceCPU:    *resource.NewMilliQuantity(int64(310), resource.DecimalSI),
									v1.ResourceMemory: *resource.NewQuantity(int64(math.Pow(2, 30)), resource.BinarySI),
								},
							},
							VolumeMounts: []v1.VolumeMount{
								{
									Name:      "file-list",
									MountPath: "/config/files",
									ReadOnly:  true,
								},
								{
									Name:      "job-config",
									MountPath: "/config/job",
									ReadOnly:  true,
								},
							},
						},
					},
					Volumes: []v1.Volume{
						{
							Name: "file-list",
							VolumeSource: v1.VolumeSource{
								ConfigMap: &v1.ConfigMapVolumeSource{
									LocalObjectReference: v1.LocalObjectReference{
										Name: filesConfigMapName,
									},
								},
							},
						},
						{
							Name: "job-config",
							VolumeSource: v1.VolumeSource{
								ConfigMap: &v1.ConfigMapVolumeSource{
									LocalObjectReference: v1.LocalObjectReference{
										Name: jobConfigMapName,
									},
								},
							},
						},
					},
				},
			},
		},
	}

	return job
}

// DeleteJob deletes a Kubernetes Job and its associated resources
func (k *K8sJobClient) DeleteJob(ctx context.Context, jobName, jobID string) error {
	propagationPolicy := metav1.DeletePropagationBackground
	deleteOptions := metav1.DeleteOptions{
		PropagationPolicy: &propagationPolicy,
	}

	// Delete the job
	err := k.clientset.BatchV1().Jobs(k.namespace).Delete(ctx, jobName, deleteOptions)
	if err != nil {
		return fmt.Errorf("failed to delete job: %w", err)
	}

	// Delete associated ConfigMaps and Secret
	filesConfigMapName := fmt.Sprintf("reprocess-%s-files", jobID)
	_ = k.clientset.CoreV1().ConfigMaps(k.namespace).Delete(ctx, filesConfigMapName, deleteOptions)

	jobConfigMapName := fmt.Sprintf("reprocess-%s-config", jobID)
	_ = k.clientset.CoreV1().ConfigMaps(k.namespace).Delete(ctx, jobConfigMapName, deleteOptions)

	secretName := fmt.Sprintf("reprocess-%s-credentials", jobID)
	_ = k.clientset.CoreV1().Secrets(k.namespace).Delete(ctx, secretName, deleteOptions)

	return nil
}

// GetJobStatus returns the status of a Kubernetes Job
func (k *K8sJobClient) GetJobStatus(ctx context.Context, jobName string) (*batchv1.JobStatus, error) {
	job, err := k.clientset.BatchV1().Jobs(k.namespace).Get(ctx, jobName, metav1.GetOptions{})
	if err != nil {
		if errors.IsNotFound(err) {
			// Job was deleted/cleaned up - return a special error
			return nil, fmt.Errorf("job not found: %w", err)
		}
		return nil, fmt.Errorf("failed to get job: %w", err)
	}

	return &job.Status, nil
}

// WorkerLogs represents logs from a single worker pod
type WorkerLogs struct {
	WorkerIndex int      `json:"worker_index"`
	PodName     string   `json:"pod_name"`
	Lines       []string `json:"lines"`
	Error       string   `json:"error,omitempty"`
}

// LogLine represents a single log line with timestamp
type LogLine struct {
	Timestamp   string `json:"timestamp"`
	WorkerIndex int    `json:"worker_index"`
	PodName     string `json:"pod_name"`
	Message     string `json:"message"`
}

// GetJobLogs fetches logs from all worker pods for a job
func (k *K8sJobClient) GetJobLogs(ctx context.Context, jobID string, tailLines int64, sinceSeconds *int64) ([]WorkerLogs, error) {
	// List all pods for this job
	labelSelector := fmt.Sprintf("job-id=%s", jobID)
	pods, err := k.clientset.CoreV1().Pods(k.namespace).List(ctx, metav1.ListOptions{
		LabelSelector: labelSelector,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list pods: %w", err)
	}

	var allLogs []WorkerLogs
	for _, pod := range pods.Items {
		// Extract worker index from completion index annotation
		workerIndex := -1
		if idx, ok := pod.Annotations["batch.kubernetes.io/job-completion-index"]; ok {
			fmt.Sscanf(idx, "%d", &workerIndex)
		}

		logOptions := &v1.PodLogOptions{
			Container:  "worker",
			TailLines:  ptr.To(tailLines),
			Timestamps: true, // Request timestamps from Kubernetes
		}
		if sinceSeconds != nil {
			logOptions.SinceSeconds = ptr.To(*sinceSeconds)
		}

		// Get logs from the pod
		req := k.clientset.CoreV1().Pods(k.namespace).GetLogs(pod.Name, logOptions)
		logStream, err := req.Stream(ctx)

		workerLog := WorkerLogs{
			WorkerIndex: workerIndex,
			PodName:     pod.Name,
			Lines:       []string{},
		}

		if err != nil {
			workerLog.Error = fmt.Sprintf("failed to get logs: %v", err)
		} else {
			defer logStream.Close()

			// Read all logs
			buf := make([]byte, 1024*1024) // 1MB buffer
			var logContent []byte
			for {
				n, err := logStream.Read(buf)
				if n > 0 {
					logContent = append(logContent, buf[:n]...)
				}
				if err != nil {
					break
				}
			}

			// Split into lines
			logStr := string(logContent)
			if logStr != "" {
				workerLog.Lines = strings.Split(strings.TrimSuffix(logStr, "\n"), "\n")
			}
		}

		allLogs = append(allLogs, workerLog)
	}

	return allLogs, nil
}

// GetJobLogsSorted fetches logs from all worker pods and returns them sorted by timestamp
func (k *K8sJobClient) GetJobLogsSorted(ctx context.Context, jobID string, tailLines int64, sinceSeconds *int64) ([]LogLine, error) {
	// Get logs from all workers
	workerLogs, err := k.GetJobLogs(ctx, jobID, tailLines, sinceSeconds)
	if err != nil {
		return nil, err
	}

	// Parse and collect all log lines with timestamps
	var allLines []LogLine
	for _, workerLog := range workerLogs {
		if workerLog.Error != "" {
			// Include error as a log line
			allLines = append(allLines, LogLine{
				Timestamp:   "",
				WorkerIndex: workerLog.WorkerIndex,
				PodName:     workerLog.PodName,
				Message:     "ERROR: " + workerLog.Error,
			})
			continue
		}

		for _, line := range workerLog.Lines {
			// Parse timestamp from line (format: "2024-01-15T10:30:45.123456789Z message")
			// Kubernetes prepends RFC3339 timestamp when Timestamps: true
			timestamp := ""
			message := line

			if len(line) > 30 && line[0] >= '0' && line[0] <= '9' {
				// Try to parse timestamp
				parts := strings.SplitN(line, " ", 2)
				if len(parts) == 2 {
					timestamp = parts[0]
					message = parts[1]
				}
			}

			allLines = append(allLines, LogLine{
				Timestamp:   timestamp,
				WorkerIndex: workerLog.WorkerIndex,
				PodName:     workerLog.PodName,
				Message:     message,
			})
		}
	}

	// Sort by timestamp
	sort.Slice(allLines, func(i, j int) bool {
		// Empty timestamps go to the end
		if allLines[i].Timestamp == "" {
			return false
		}
		if allLines[j].Timestamp == "" {
			return true
		}
		return allLines[i].Timestamp < allLines[j].Timestamp
	})

	return allLines, nil
}
