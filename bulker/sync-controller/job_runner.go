package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/hjson/hjson-go/v4"
	"github.com/jitsucom/bulker/jitsubase/appbase"
	"github.com/jitsucom/bulker/jitsubase/safego"
	"github.com/jitsucom/bulker/jitsubase/types"
	"github.com/jitsucom/bulker/jitsubase/utils"
	"github.com/jitsucom/bulker/jitsubase/uuid"
	"github.com/mitchellh/mapstructure"
	v1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/remotecommand"
	"k8s.io/utils/ptr"
)

const (
	k8sLabelPrefix       = "jitsu.com/"
	k8sCreatorLabel      = k8sLabelPrefix + "creator"
	k8sCreatorLabelValue = "bulker-sync-controller"
)

// regex non alphanumeric characters
var labelUnsupportedChars = regexp.MustCompile(`[^a-zA-Z0-9._-]`)
var nonAlphaNum = regexp.MustCompile(`[^a-zA-Z0-9-]`)

var cgroupCPUUsage = regexp.MustCompile(`(?m:^usage_usec (\d+)$)`)
var cgroupMemUsage = regexp.MustCompile(`(?m:^(\d+)$)`)

type JobRunner struct {
	appbase.Service
	config        *Config
	namespace     string
	clientConfig  *rest.Config
	clientset     *kubernetes.Clientset
	closeCh       chan struct{}
	taskStatusCh  chan *TaskStatus
	runningPods   map[string]time.Time
	runningSyncs  sync.Map
	cleanedUpPods types.Set[string]
	waitGroup     sync.WaitGroup
	inited        atomic.Bool
}

func NewJobRunner(appContext *Context) (*JobRunner, error) {
	base := appbase.NewServiceBase("job-runner")
	clientset, clientConfig, err := GetK8SClientSet(appContext)
	if err != nil {
		return nil, err
	}
	j := &JobRunner{Service: base, config: appContext.config, clientset: clientset, clientConfig: clientConfig, namespace: appContext.config.KubernetesNamespace,
		closeCh:       make(chan struct{}),
		taskStatusCh:  make(chan *TaskStatus, 100),
		runningPods:   map[string]time.Time{},
		cleanedUpPods: types.NewSet[string](),
	}
	safego.RunWithRestart(j.watchPodStatuses)
	return j, nil
}

func (j *JobRunner) watchPodStatuses() {
	ticker := utils.NewTicker(time.Second*time.Duration(j.config.ContainerStatusCheckSeconds), time.Second*time.Duration(j.config.ContainerStatusCheckSeconds))
	defer ticker.Stop()
	for {
		select {
		case <-j.closeCh:
			return
		case <-ticker.C:
			list, err := j.clientset.CoreV1().Pods(j.namespace).List(context.Background(), metav1.ListOptions{LabelSelector: k8sCreatorLabel + "=" + k8sCreatorLabelValue})
			if err != nil {
				j.Errorf("failed to list pods: %v", err.Error())
				continue
			}
			activePods := types.NewSet[string]()
			activeSyncs := types.NewSet[string]()
			for _, pod := range list.Items {
				activePods.Put(pod.Name)
				if j.cleanedUpPods.Contains(pod.Name) {
					continue
				}
				taskStatus := TaskStatus{}
				_ = mapstructure.Decode(pod.Annotations, &taskStatus)
				// Cron-spawned pods (label app=sync-cron) carry the build-time
				// known TaskDescriptor fields in annotations, but taskId is
				// per-fire — derive from pod.Name (same value the cron pod
				// gets injected as TASK_ID env via metadata.name fieldRef).
				if taskStatus.TaskID == "" {
					taskStatus.TaskID = pod.Name
				}
				if taskStatus.TaskType == "read" {
					activeSyncs.Put(taskStatus.SyncID)
				}
				taskStatus.PodName = pod.Name
				status := pod.Status
				bytes, _ := json.Marshal(status)
				j.Debugf("Pod %s Status %s:\n%s", pod.Name, status.Phase, string(bytes))
				switch status.Phase {
				case v1.PodSucceeded:
					taskStatus.Status = StatusSuccess
					j.Infof("Pod %s succeeded. Cleaning up.", pod.Name)
					j.cleanupPod(pod.Name)
					if taskStatus.TaskType == "read" {
						j.runningSyncs.Delete(taskStatus.SyncID)
					}
				case v1.PodFailed:
					taskStatus.Status = StatusFailed
					errors, _ := j.accumulateErrorLogs(pod.Name, taskStatus.TaskType, status)
					if len(strings.TrimSpace(errors)) == 0 {
						errors = accumulatePodStatus(status)
					}
					taskStatus.Error = errors
					j.Infof("Pod %s failed. Cleaning up.", pod.Name)
					if taskStatus.TaskType == "read" {
						j.runningSyncs.Delete(taskStatus.SyncID)
					}
					j.cleanupPod(pod.Name)
				case v1.PodRunning:
					errors, sourceFailed := j.accumulateErrorLogs(pod.Name, taskStatus.TaskType, status)
					if len(strings.TrimSpace(errors)) == 0 && sourceFailed {
						errors = accumulatePodStatus(status)
					}
					if len(errors) > 0 || sourceFailed {
						taskStatus.Status = StatusFailed
						taskStatus.Error = errors
						j.Infof("Pod %s is running but had errors. Cleaning up.", pod.Name)
						j.cleanupPod(pod.Name)
					} else {
						if timeMark, ok := j.runningPods[pod.Name]; !ok || time.Now().Sub(timeMark) >= time.Minute {
							if time.Now().Sub(taskStatus.StartedAtTime()) > time.Hour*time.Duration(j.config.TaskTimeoutHours) {
								taskStatus.Status = StatusTimeExceeded
								taskStatus.Error = fmt.Sprintf("Task timeout: The task has been running for more than %d hours. Consider splitting the selected streams into multiple Sync entities.", j.config.TaskTimeoutHours)
								j.Errorf("Pod %s is running for more than %d hours. Deleting", pod.Name, j.config.TaskTimeoutHours)
								j.cleanupPod(pod.Name)
							} else {
								taskStatus.Status = StatusRunning
								metrics := j.getPodResUsage(pod.Name, "source")
								if len(metrics) > 0 {
									taskStatus.Metrics = metrics
								}
								j.Infof("Pod %s is running", pod.Name)
								j.runningPods[pod.Name] = time.Now()
								if taskStatus.TaskType == "read" || utils.IsTruish(taskStatus.ThenRun) {
									j.runningSyncs.Store(taskStatus.SyncID, taskStatus.TaskID)
								}
							}
						} else {
							//report running status only once per minute
							continue
						}

					}
				case v1.PodPending:
					if time.Now().Sub(taskStatus.StartedAtTime()) > time.Second*time.Duration(j.config.ContainerInitTimeoutSeconds) {
						taskStatus.Status = StatusInitTimeout
						taskStatus.Error = accumulatePodStatus(status)
						j.Errorf("Pod %s is pending for more than %d seconds. Deleting", pod.Name, j.config.ContainerInitTimeoutSeconds)
						j.cleanupPod(pod.Name)
					} else {
						taskStatus.Status = StatusPending
						taskStatus.Error = accumulatePodStatus(status)
						if taskStatus.TaskType == "read" {
							j.runningSyncs.Store(taskStatus.SyncID, taskStatus.TaskID)
						}
						j.Debugf("Pod %s is pending", pod.Name)
						continue
					}
				default:
					taskStatus.Status = StatusUnknown
					taskStatus.Error = accumulatePodStatus(status)
					j.SystemErrorf("Pod %s is in unknown state %s", pod.Name, status.Phase)
				}
				j.sendStatus(&taskStatus)
			}
			//clean up pods that are not active anymore
			for podName := range j.runningPods {
				if !activePods.Contains(podName) {
					delete(j.runningPods, podName)
				}
			}
			//clean up syncs that are not active anymore
			j.runningSyncs.Range(func(syncId any, _ any) bool {
				if !activeSyncs.Contains(syncId.(string)) {
					j.runningSyncs.Delete(syncId)
				}
				return true
			})
			for podName := range j.cleanedUpPods {
				if !activePods.Contains(podName) {
					j.cleanedUpPods.Remove(podName)
				}
			}
			j.inited.Store(true)
		}
	}

}

func (j *JobRunner) sendStatus(taskStatus *TaskStatus) {
	select {
	case j.taskStatusCh <- taskStatus:
	case <-time.After(time.Second * 5):
		j.SystemErrorf("taskStatusCh is full. Dropping task status: %+v", *taskStatus)
	}
}

func (j *JobRunner) cleanupPod(name string) {
	j.cleanedUpPods.Put(name)
	gracePeriodSeconds := int64(j.config.ContainerGraceShutdownSeconds + 5)
	_ = j.clientset.CoreV1().Pods(j.namespace).Delete(context.Background(), name, metav1.DeleteOptions{GracePeriodSeconds: &gracePeriodSeconds})
	_ = j.clientset.CoreV1().Secrets(j.namespace).Delete(context.Background(), name+"-config", metav1.DeleteOptions{GracePeriodSeconds: &gracePeriodSeconds})
	_ = j.clientset.CoreV1().ConfigMaps(j.namespace).Delete(context.Background(), name+"-config", metav1.DeleteOptions{GracePeriodSeconds: &gracePeriodSeconds})
}

func accumulatePodStatus(status v1.PodStatus) string {
	stb := strings.Builder{}
	//gather status from all containers
	c := make([]v1.ContainerStatus, 0, len(status.ContainerStatuses)+len(status.InitContainerStatuses))
	c = append(c, status.InitContainerStatuses...)
	c = append(c, status.ContainerStatuses...)
	for _, s := range c {
		state := s.State
		if state.Terminated != nil {
			stb.WriteString(fmt.Sprintf("[%s] exit code %d message: %s. %s\n", s.Name, state.Terminated.ExitCode, state.Terminated.Reason, state.Terminated.Message))
		} else if state.Running != nil {
			stb.WriteString(fmt.Sprintf("[%s] running\n", s.Name))
		}
	}
	return stb.String()
}

func (j *JobRunner) accumulateErrorLogs(podName string, taskType string, status v1.PodStatus) (logs string, sourceFailed bool) {
	stb := strings.Builder{}
	// Gather statuses from init + regular containers into a map keyed by
	// container name. Names are unique within a pod, so there are no
	// collisions.
	statuses := make(map[string]v1.ContainerStatus, len(status.ContainerStatuses)+len(status.InitContainerStatuses))
	for _, s := range status.InitContainerStatuses {
		statuses[s.Name] = s
	}
	for _, s := range status.ContainerStatuses {
		statuses[s.Name] = s
	}
	for _, s := range statuses {
		state := s.State
		if state.Terminated != nil && state.Terminated.ExitCode != 0 {
			sourceFailed = true
			if s.Name == "source" && taskType == "read" {
				// Read-mode source failures are surfaced by the sidecar
				// itself (it owns the stdout/stderr pipes and may have
				// already streamed some streams successfully). Don't
				// double-report here.
				continue
			}
			// Pull logs from the actually-failing container — historically
			// this was hardcoded to "source", which silently swallowed init
			// container stderr (e.g. discover's bad-SSL-PEM crash) and
			// produced empty source_task.error rows.
			cl := j.getPodLogs(podName, s, true, 50)
			if len(cl) > 0 {
				stb.WriteString(s.Name)
				stb.WriteString(": ")
				stb.WriteString(cl)
				stb.WriteRune('\n')
			}
			// State.Terminated.Message is the kubelet-captured tail of the
			// container's termination output (k8s defaults: 4 KiB).
			// Surface it when GetLogs returned nothing useful — e.g. for
			// OOMKilled or runc create failures where no log lines exist.
			if len(cl) == 0 && state.Terminated.Message != "" {
				stb.WriteString(s.Name)
				stb.WriteString(": ")
				stb.WriteString(state.Terminated.Message)
				stb.WriteRune('\n')
			}
		}
	}
	// all source logs get directed to pipe and translated to the sidecar
	// so if 'source' container fails we need to look for errors in the sidecar
	if stb.Len() == 0 && sourceFailed {
		sidecarC := statuses["sidecar"]
		logs := j.getPodLogs(podName, sidecarC, true, 50)
		if len(logs) > 0 {
			stb.WriteString(logs)
			stb.WriteRune('\n')
		} else {
			// if we couldn't find lines with errors in the sidecar logs - get last 5 lines
			logs = j.getPodLogs(podName, sidecarC, false, 5)
			if len(logs) > 0 {
				stb.WriteString(logs)
				stb.WriteRune('\n')
			} else {
				logs = j.getPodLogs(podName, statuses["source"], false, 5)
				if len(logs) > 0 {
					stb.WriteString(logs)
					stb.WriteRune('\n')
				}
			}
		}
	}
	return stb.String(), sourceFailed
}

func (j *JobRunner) getPodLogs(podName string, container v1.ContainerStatus, onlyErrors bool, tailLines int64) string {
	if container.State.Waiting != nil {
		return ""
	}
	req := j.clientset.CoreV1().Pods(j.namespace).GetLogs(podName, &v1.PodLogOptions{Container: container.Name, TailLines: &tailLines})
	podLogs, err := req.Stream(context.Background())
	if err != nil {
		return fmt.Sprintf("ERR_FAILED_TO_READ_POD_LOGS:%s", err.Error())
	}
	defer podLogs.Close()
	buf := strings.Builder{}
	scanner := bufio.NewScanner(podLogs)
	scanner.Buffer(make([]byte, 1024*10), 1024*1024*10)
	errFound := false
	for scanner.Scan() {
		t := scanner.Text()
		if onlyErrors {
			tL := strings.ToLower(t)
			if !errFound && (strings.Contains(tL, "error") || strings.Contains(tL, "panic") || strings.Contains(tL, "errstd") || strings.Contains(tL, "fatal")) {
				errFound = true
			}
			//log everything after error was found
			if errFound {
				buf.WriteString(fmt.Sprintf("%s\n", t))
			}
		} else {
			buf.WriteString(fmt.Sprintf("%s\n", t))
		}
	}
	if err = scanner.Err(); err != nil {
		return fmt.Sprintf("ERR_FAILED_TO_READ_POD_LOGS:%s", err.Error())
	}
	if buf.Len() > 0 {
		return fmt.Sprintf("[%s]: %s", container.Name, buf.String())
	} else {
		return ""
	}
}

func (j *JobRunner) getPodResUsage(podName string, container string) (metrics map[string]any) {
	startedAt := time.Now()
	var err error
	defer func() {
		if err != nil {
			j.Errorf("Pod %s resource usage: %+v ms: %v error: %v", podName, metrics, time.Now().Sub(startedAt), err)
		} else {
			j.Infof("Pod %s resource usage: %+v ms: %v", podName, metrics, time.Now().Sub(startedAt))
		}
	}()
	cmd := []string{
		"sh",
		"-c",
		"cat /sys/fs/cgroup/cpu.stat && cat /sys/fs/cgroup/memory.current && cat /sys/fs/cgroup/memory.peak",
	}
	req := j.clientset.CoreV1().RESTClient().Post().Resource("pods").Name(podName).
		Namespace(j.namespace).SubResource("exec")
	option := &v1.PodExecOptions{
		Container: container,
		Command:   cmd,
		Stdout:    true,
		Stderr:    true,
	}
	req.VersionedParams(
		option,
		scheme.ParameterCodec,
	)
	exec, err := remotecommand.NewSPDYExecutor(j.clientConfig, "POST", req.URL())
	if err != nil {
		return nil
	}
	var stdout, stderr bytes.Buffer
	err = exec.StreamWithContext(context.Background(), remotecommand.StreamOptions{
		Stdout: &stdout,
		Stderr: &stderr,
	})
	if err != nil {
		return nil
	}
	metrics = map[string]any{}
	stdoutStr := stdout.String()
	cpuUsageMatches := cgroupCPUUsage.FindStringSubmatch(stdoutStr)
	if len(cpuUsageMatches) == 2 {
		c, _ := strconv.Atoi(cpuUsageMatches[1])
		if c > 0 {
			metrics["cpu_usage"] = float64(c) / 1000000
		}
	}
	memUsage := 0
	memUsageAllMatches := cgroupMemUsage.FindAllStringSubmatch(stdoutStr, -1)
	for _, memUsageMatches := range memUsageAllMatches {
		if len(memUsageMatches) == 2 {
			m, _ := strconv.Atoi(memUsageMatches[1])
			memUsage = utils.MaxInt(memUsage, m)
		}
	}
	if memUsage > 0 {
		metrics["mem_usage"] = memUsage
	}
	if stderr.Len() > 0 {
		err = fmt.Errorf(stderr.String())
	}

	return metrics
}

//func (j *JobRunner) CreateCronJob(taskDescriptor TaskDescriptor, configuration *TaskConfiguration) TaskStatus {
//	taskStatus := TaskStatus{TaskDescriptor: taskDescriptor}
//	jobId := "sync-" + strings.ToLower(taskStatus.SyncID)
//	if !configuration.IsEmpty() {
//		secret := j.createSecret(jobId, taskDescriptor, configuration)
//		_, err := j.clientset.CoreV1().Secrets(j.namespace).Create(context.Background(), secret, metav1.CreateOptions{})
//		if err != nil {
//			taskStatus.Status = StatusCreateFailed
//			taskStatus.Description = err.Error()
//			j.sendStatus(&taskStatus)
//			return taskStatus
//		}
//	}
//	cronJob := j.createCronJob(jobId, taskDescriptor, configuration)
//	cronJob, err := j.clientset.BatchV1().CronJobs(j.namespace).Create(context.Background(), cronJob, metav1.CreateOptions{})
//	if err != nil {
//		taskStatus.Status = StatusCreateFailed
//		taskStatus.Description = err.Error()
//	} else {
//		taskStatus.Status = StatusCreated
//		taskStatus.Description = "Starting sync job..."
//		taskStatus.PodName = cronJob.Name
//	}
//	j.sendStatus(&taskStatus)
//	return taskStatus
//}

func PodName(syncId, taskId, pkg, taskType string) string {
	taskId = utils.NvlString(taskId, uuid.New())[32:]
	pkg = strings.TrimPrefix(pkg, "airbyte/source-")
	pkg = strings.TrimPrefix(pkg, "jitsucom/source-")
	podId := nonAlphaNum.ReplaceAllLiteralString(pkg, "-") + "-" + syncId + "-" + taskType + "-" + taskId
	return strings.ToLower(podId)
}

func (j *JobRunner) CreateJob(taskDescriptor TaskDescriptor, configuration *TaskConfiguration) TaskStatus {
	startedBy := map[string]any{}
	_ = json.Unmarshal([]byte(taskDescriptor.StartedBy), &startedBy)
	byScheduler := startedBy["trigger"] == "scheduled"
	if !byScheduler || utils.IsTruish(taskDescriptor.Nodelay) {
		return j.createJob(taskDescriptor, configuration)
	} else {
		j.waitGroup.Add(1)
		go func() {
			defer j.waitGroup.Done()
			sleepSec := utils.HashStringInt(taskDescriptor.SyncID) % 60
			time.Sleep(time.Second * time.Duration(sleepSec))
			taskId, running := j.runningSyncs.Load(taskDescriptor.SyncID)
			if !running {
				taskDescriptor.StartedAt = time.Now().Format(time.RFC3339)
				j.createJob(taskDescriptor, configuration)
				j.runningSyncs.Store(taskDescriptor.SyncID, taskDescriptor.TaskID)
			} else {
				j.Infof("Sync %s has an already running task: %s. Skipping job creation.", taskDescriptor.SyncID, taskId)
			}
		}()
		return TaskStatus{Status: StatusPending}
	}
}

func (j *JobRunner) createJob(taskDescriptor TaskDescriptor, configuration *TaskConfiguration) TaskStatus {
	taskStatus := TaskStatus{TaskDescriptor: taskDescriptor}
	podName := taskDescriptor.PodName()
	if !configuration.IsEmpty() {
		secret := j.createSecret(podName, taskDescriptor, configuration)
		_, err := j.clientset.CoreV1().Secrets(j.namespace).Create(context.Background(), secret, metav1.CreateOptions{})
		if err != nil {
			if strings.Contains(err.Error(), "already exists") {
				j.Infof("Secret already exists. Looks like other instance already creating job: %s", taskDescriptor.TaskID)
				taskStatus.Status = StatusAlreadyCreated
				return taskStatus
			}
			taskStatus.Status = StatusCreateFailed
			taskStatus.Error = err.Error()
			j.sendStatus(&taskStatus)
			return taskStatus
		}
	}
	pod := j.createPod(podName, taskDescriptor, configuration)
	pod, err := j.clientset.CoreV1().Pods(j.namespace).Create(context.Background(), pod, metav1.CreateOptions{})
	if err != nil {
		if strings.Contains(err.Error(), "already exists") {
			j.Infof("Pod already exists. Looks like other instance already created job: %s", taskDescriptor.TaskID)
			taskStatus.Status = StatusAlreadyCreated
			return taskStatus
		}
		taskStatus.Status = StatusCreateFailed
		taskStatus.Error = err.Error()
	} else {
		taskStatus.Status = StatusCreated
		taskStatus.PodName = pod.Name
	}
	j.sendStatus(&taskStatus)
	return taskStatus
}

func (j *JobRunner) createSecret(podName string, task TaskDescriptor, configuration *TaskConfiguration) *v1.Secret {
	trueVar := true
	configMapName := podName + "-config"
	if configuration.IsEmpty() {
		return nil
	}
	cm := &v1.Secret{
		TypeMeta: metav1.TypeMeta{
			Kind: "Secret",
		},
		ObjectMeta: metav1.ObjectMeta{
			Name:      configMapName,
			Labels:    map[string]string{k8sCreatorLabel: k8sCreatorLabelValue},
			Namespace: j.namespace,
		},
		Immutable: &trueVar,
		Data:      configuration.ToMap(),
	}
	return cm
}

//
//func (j *JobRunner) createCronJob(jobId string, task TaskDescriptor, configuration *TaskConfiguration) *v1batch.CronJob {
//	var command string
//	switch task.TaskType {
//	case "check":
//		command = "check --config /config/config.json"
//	case "discover":
//		command = "discover --config /config/config.json"
//	case "read":
//		command = "read --config /config/config.json --catalog /config/catalog.json --state /config/state.json"
//	case "spec":
//		command = "spec"
//	}
//	databaseURL := utils.NvlString(j.config.SidecarDatabaseURL, j.config.DatabaseURL)
//	sideCarEnv := map[string]string{
//		"STDOUT_PIPE_FILE":  "/pipes/stdout",
//		"STDERR_PIPE_FILE":  "/pipes/stderr",
//		"PACKAGE":           task.Package,
//		"PACKAGE_VERSION":   task.PackageVersion,
//		"COMMAND":           task.TaskType,
//		"NAMESPACE":         task.Namespace,
//		"TO_SAME_CASE":      task.ToSameCase,
//		"ADD_META":          task.AddMeta,
//		"TABLE_NAME_PREFIX": task.TableNamePrefix,
//		"FULL_SYNC":         task.FullSync,
//		"DATABASE_URL":      databaseURL,
//		"LOG_LEVEL":         j.config.LogLevel,
//		"DB_LOG_LEVEL":      j.config.DBLogLevel,
//		"STARTED_BY":        task.StartedBy,
//		"STARTED_AT":        task.StartedAt,
//	}
//	if task.SyncID != "" {
//		sideCarEnv["SYNC_ID"] = task.SyncID
//	}
//	if task.TaskID != "" {
//		sideCarEnv["TASK_ID"] = task.TaskID
//	}
//	if task.StorageKey != "" {
//		sideCarEnv["STORAGE_KEY"] = task.StorageKey
//	}
//	//utils.MapPutAll(sideCarEnv, envMap)
//	sideCarEnvVar := make([]v1.EnvVar, 0, len(sideCarEnv))
//	for k, v := range sideCarEnv {
//		sideCarEnvVar = append(sideCarEnvVar, v1.EnvVar{Name: k, Value: v})
//	}
//	volumes := []v1.Volume{
//		{
//			Name: "pipes",
//			VolumeSource: v1.VolumeSource{
//				EmptyDir: &v1.EmptyDirVolumeSource{},
//			},
//		},
//	}
//	volumeMounts := []v1.VolumeMount{
//		{
//			Name:      "pipes",
//			MountPath: "/pipes",
//		},
//	}
//	var nodeSelector map[string]string
//	if j.config.KubernetesNodeSelector != "" {
//		nodeSelector = map[string]string{}
//		err := hjson.Unmarshal([]byte(j.config.KubernetesNodeSelector), &nodeSelector)
//		if err != nil {
//			j.Errorf("failed to parse node selector from string: %s\nIngoring it. Error: %v", j.config.KubernetesNodeSelector, err)
//		}
//	}
//	initCommand := []string{"sh", "-c", "mkfifo /pipes/stdout; mkfifo /pipes/stderr"}
//	if !configuration.IsEmpty() {
//		initCommand = []string{"sh", "-c", "mkfifo /pipes/stdout; mkfifo /pipes/stderr; cp /configmap/* /config/; gunzip /config/*.gz"}
//		items := []v1.KeyToPath{}
//		for _, k := range configuration.Keys() {
//			items = append(items, v1.KeyToPath{
//				Key:  k,
//				Path: k + ".json.gz",
//			})
//		}
//		volumes = append(volumes, v1.Volume{
//			Name: "configmap",
//			VolumeSource: v1.VolumeSource{
//				Secret: &v1.SecretVolumeSource{
//					SecretName: jobId + "-config",
//					Items:      items,
//				},
//			},
//		})
//		volumes = append(volumes, v1.Volume{
//			Name: "config",
//			VolumeSource: v1.VolumeSource{
//				EmptyDir: &v1.EmptyDirVolumeSource{},
//			},
//		})
//		volumeMounts = append(volumeMounts, v1.VolumeMount{
//			Name:      "configmap",
//			MountPath: "/configmap",
//		})
//		volumeMounts = append(volumeMounts, v1.VolumeMount{
//			Name:      "config",
//			MountPath: "/config",
//		})
//	}
//	//truevar := true
//	tz := "Etc/UTC"
//	cronJob := &v1batch.CronJob{
//		TypeMeta: metav1.TypeMeta{
//			Kind: "CronJob",
//		},
//		ObjectMeta: metav1.ObjectMeta{
//			Name:        jobId,
//			Labels:      map[string]string{k8sCreatorLabel: k8sCreatorLabelValue},
//			Annotations: task.ExtractAnnotations(),
//			Namespace:   j.namespace,
//		},
//		Spec: v1batch.CronJobSpec{
//			Schedule: "*/2 * * * *",
//			TimeZone: &tz,
//			//Suspend:           &truevar,
//			ConcurrencyPolicy: v1batch.ForbidConcurrent,
//			JobTemplate: v1batch.JobTemplateSpec{
//				Spec: v1batch.JobSpec{
//					Template: v1.PodTemplateSpec{
//						ObjectMeta: metav1.ObjectMeta{
//							Name:        jobId,
//							Labels:      map[string]string{k8sCreatorLabel: k8sCreatorLabelValue},
//							Annotations: task.ExtractAnnotations(),
//							Namespace:   j.namespace,
//						},
//						Spec: v1.PodSpec{
//							RestartPolicy:                 v1.RestartPolicyNever,
//							NodeSelector:                  nodeSelector,
//							TerminationGracePeriodSeconds: ptr.To(int64(j.config.ContainerGraceShutdownSeconds)),
//							Containers: []v1.Container{
//								{Name: "source",
//									Image:   fmt.Sprintf("%s:%s", task.Package, task.PackageVersion),
//									Command: []string{"sh", "-c", fmt.Sprintf("eval \"$AIRBYTE_ENTRYPOINT %s\" 2> /pipes/stderr > /pipes/stdout", command)},
//									Env: []v1.EnvVar{{Name: "USE_STREAM_CAPABLE_STATE", Value: "true"},
//										{Name: "AUTO_DETECT_SCHEMA", Value: "true"}},
//									VolumeMounts: volumeMounts,
//									Resources: v1.ResourceRequirements{
//										Limits: v1.ResourceList{
//											v1.ResourceCPU: *resource.NewMilliQuantity(int64(2000), resource.DecimalSI),
//											// 2Gi
//											v1.ResourceMemory: *resource.NewQuantity(int64(math.Pow(2, 31)), resource.BinarySI),
//										},
//										Requests: v1.ResourceList{
//											v1.ResourceCPU: *resource.NewMilliQuantity(int64(125), resource.DecimalSI),
//											// 256Mi
//											v1.ResourceMemory: *resource.NewQuantity(int64(math.Pow(2, 29)), resource.BinarySI),
//										},
//									},
//								},
//								{
//									Name:            "sidecar",
//									ImagePullPolicy: v1.PullAlways,
//									Image:           j.config.SidecarImage,
//									Env:             sideCarEnvVar,
//									VolumeMounts:    volumeMounts,
//									Resources: v1.ResourceRequirements{
//										Limits: v1.ResourceList{
//											v1.ResourceCPU: *resource.NewMilliQuantity(int64(1000), resource.DecimalSI),
//											// 512Mi
//											v1.ResourceMemory: *resource.NewQuantity(int64(math.Pow(2, 29)), resource.BinarySI),
//										},
//										Requests: v1.ResourceList{
//											v1.ResourceCPU: *resource.NewMilliQuantity(int64(0), resource.DecimalSI),
//											// 256
//											v1.ResourceMemory: *resource.NewQuantity(int64(0), resource.BinarySI),
//										},
//									},
//								},
//							},
//							InitContainers: []v1.Container{
//								{
//									Name:         "init",
//									Image:        "alpine",
//									Command:      initCommand,
//									VolumeMounts: volumeMounts,
//								},
//							},
//							Volumes: volumes,
//						},
//					},
//				},
//			},
//		},
//	}
//	return cronJob
//}

func (j *JobRunner) TerminatePod(podName string) {
	_ = j.clientset.CoreV1().Pods(j.namespace).Delete(context.Background(), podName, metav1.DeleteOptions{})
	_ = j.clientset.CoreV1().Secrets(j.namespace).Delete(context.Background(), podName+"-config", metav1.DeleteOptions{})
	_ = j.clientset.CoreV1().ConfigMaps(j.namespace).Delete(context.Background(), podName+"-config", metav1.DeleteOptions{})
}

func (j *JobRunner) createPod(podName string, task TaskDescriptor, configuration *TaskConfiguration) *v1.Pod {
	var command string
	debug := utils.Ternary(task.Debug == "true", "--debug ", "")
	switch task.TaskType {
	case "check":
		command = "check --config /config/config.json"
	case "discover":
		command = "discover --config /config/config.json"
	case "read":
		command = "read " + debug + "--config /config/config.json --catalog /config/catalog.json --state /config/state.json"
	case "spec":
		command = "spec"
	}
	databaseURL := utils.NvlString(j.config.SidecarDatabaseURL, j.config.DatabaseURL)
	sideCarEnv := map[string]string{
		"STDOUT_PIPE_FILE":       "/pipes/stdout",
		"STDERR_PIPE_FILE":       "/pipes/stderr",
		"PACKAGE":                task.Package,
		"PACKAGE_VERSION":        task.PackageVersion,
		"COMMAND":                task.TaskType,
		"NAMESPACE":              task.Namespace,
		"TO_SAME_CASE":           task.ToSameCase,
		"ADD_META":               task.AddMeta,
		"DEDUPLICATE":            task.Deduplicate,
		"TABLE_NAME_PREFIX":      task.TableNamePrefix,
		"FULL_SYNC":              task.FullSync,
		"DATABASE_URL":           databaseURL,
		"LOG_LEVEL":              j.config.LogLevel,
		"DB_LOG_LEVEL":           j.config.DBLogLevel,
		"STARTED_BY":             task.StartedBy,
		"STARTED_AT":             task.StartedAt,
		"TASK_TIMEOUT_HOURS":     strconv.Itoa(j.config.TaskTimeoutHours),
		"LOCAL_INGEST_ENDPOINT":  j.config.LocalIngestEndpoint,
		"GLOBAL_INGEST_ENDPOINT": j.config.GlobalIngestEndpoint,
		"AWS_ACCESS_KEY_ID":      os.Getenv("AWS_ACCESS_KEY_ID"),
		"AWS_SECRET_ACCESS_KEY":  os.Getenv("AWS_SECRET_ACCESS_KEY"),
		"AWS_DEFAULT_REGION":     os.Getenv("AWS_DEFAULT_REGION"),
	}
	if task.SyncID != "" {
		sideCarEnv["SYNC_ID"] = task.SyncID
	}
	if task.TaskID != "" {
		sideCarEnv["TASK_ID"] = task.TaskID
	}
	if task.StorageKey != "" {
		sideCarEnv["STORAGE_KEY"] = task.StorageKey
	}
	if j.config.ClickhouseURL != "" || j.config.ClickhouseHost != "" {
		if j.config.ClickhouseURL != "" {
			sideCarEnv["CLICKHOUSE_URL"] = j.config.ClickhouseURL
		}
		if j.config.ClickhouseHost != "" {
			sideCarEnv["CLICKHOUSE_HOST"] = j.config.ClickhouseHost
		}
		sideCarEnv["CLICKHOUSE_DATABASE"] = j.config.ClickhouseDatabase
		sideCarEnv["CLICKHOUSE_USERNAME"] = j.config.ClickhouseUsername
		sideCarEnv["CLICKHOUSE_PASSWORD"] = j.config.ClickhousePassword
		sideCarEnv["CLICKHOUSE_SSL"] = fmt.Sprintf("%t", j.config.ClickhouseSSL)
	}
	if configuration != nil && len(configuration.FunctionsEnv) > 0 {
		b, _ := json.Marshal(configuration.FunctionsEnv)
		sideCarEnv["FUNCTIONS_ENV"] = string(b)
	}
	//utils.MapPutAll(sideCarEnv, envMap)
	sideCarEnvVar := make([]v1.EnvVar, 0, len(sideCarEnv))
	for k, v := range sideCarEnv {
		sideCarEnvVar = append(sideCarEnvVar, v1.EnvVar{Name: k, Value: v})
	}
	volumes := []v1.Volume{
		{
			Name: "pipes",
			VolumeSource: v1.VolumeSource{
				EmptyDir: &v1.EmptyDirVolumeSource{},
			},
		},
	}
	volumeMounts := []v1.VolumeMount{
		{
			Name:      "pipes",
			MountPath: "/pipes",
		},
	}
	var nodeSelector map[string]string
	if j.config.KubernetesNodeSelector != "" {
		nodeSelector = map[string]string{}
		err := hjson.Unmarshal([]byte(j.config.KubernetesNodeSelector), &nodeSelector)
		if err != nil {
			j.Errorf("failed to parse node selector from string: %s\nIngoring it. Error: %v", j.config.KubernetesNodeSelector, err)
		}
	}
	initCommand := []string{"sh", "-c", "mkfifo /pipes/stdout; mkfifo /pipes/stderr; chmod 777 /pipes/*; echo \"OK\""}
	if !configuration.IsEmpty() {
		initCommand = []string{"sh", "-c", "mkfifo /pipes/stdout; mkfifo /pipes/stderr; chmod 777 /pipes/*; cp /configmap/* /config/; gunzip /config/*.gz; chmod 777 /config/*; echo \"OK\""}
		items := []v1.KeyToPath{}
		for _, k := range configuration.Keys() {
			items = append(items, v1.KeyToPath{
				Key:  k,
				Path: k + ".json.gz",
			})
		}
		volumes = append(volumes, v1.Volume{
			Name: "configmap",
			VolumeSource: v1.VolumeSource{
				Secret: &v1.SecretVolumeSource{
					SecretName: podName + "-config",
					Items:      items,
				},
			},
		})
		volumes = append(volumes, v1.Volume{
			Name: "config",
			VolumeSource: v1.VolumeSource{
				EmptyDir: &v1.EmptyDirVolumeSource{},
			},
		})
		volumeMounts = append(volumeMounts, v1.VolumeMount{
			Name:      "configmap",
			MountPath: "/configmap",
		})
		volumeMounts = append(volumeMounts, v1.VolumeMount{
			Name:      "config",
			MountPath: "/config",
		})
	}
	pod := &v1.Pod{
		TypeMeta: metav1.TypeMeta{
			Kind: "Pod",
		},
		ObjectMeta: metav1.ObjectMeta{
			Name:        podName,
			Labels:      map[string]string{k8sCreatorLabel: k8sCreatorLabelValue},
			Annotations: task.ExtractAnnotations(),
			Namespace:   j.namespace,
		},
		Spec: v1.PodSpec{
			RestartPolicy:                 v1.RestartPolicyNever,
			NodeSelector:                  nodeSelector,
			TerminationGracePeriodSeconds: ptr.To(int64(j.config.ContainerGraceShutdownSeconds)),
			ServiceAccountName:            j.config.PodsServiceAccount,
			//SecurityContext:               &v1.PodSecurityContext{FSGroup: ptr.To(int64(65534))},
			Containers: []v1.Container{
				{Name: "source",
					Image:   fmt.Sprintf("%s:%s", task.Package, task.PackageVersion),
					Command: []string{"sh", "-c", fmt.Sprintf("eval \"$AIRBYTE_ENTRYPOINT %s\" 2> /pipes/stderr > /pipes/stdout", command)},
					Env: []v1.EnvVar{{Name: "USE_STREAM_CAPABLE_STATE", Value: "true"},
						{Name: "AUTO_DETECT_SCHEMA", Value: "true"},
						{Name: "JAVA_OPTS", Value: "-Xmx7000m"}},

					VolumeMounts: volumeMounts,
					Resources: v1.ResourceRequirements{
						Limits: v1.ResourceList{
							v1.ResourceCPU: *resource.NewMilliQuantity(int64(1000), resource.DecimalSI),
							// 8Gi
							v1.ResourceMemory: *resource.NewQuantity(int64(math.Pow(2, 33)), resource.BinarySI),
						},
						Requests: v1.ResourceList{
							v1.ResourceCPU: *resource.NewMilliQuantity(int64(100), resource.DecimalSI),
							// 256Mi
							v1.ResourceMemory: *resource.NewQuantity(int64(math.Pow(2, 28)), resource.BinarySI),
						},
					},
				},
				{
					Name:            "sidecar",
					ImagePullPolicy: v1.PullAlways,
					Image:           j.config.SidecarImage,
					Env:             sideCarEnvVar,
					VolumeMounts:    volumeMounts,
					Resources: v1.ResourceRequirements{
						Limits: v1.ResourceList{
							v1.ResourceCPU: *resource.NewMilliQuantity(int64(500), resource.DecimalSI),
							// 4Gi
							v1.ResourceMemory: *resource.NewQuantity(int64(math.Pow(2, 32)), resource.BinarySI),
						},
						Requests: v1.ResourceList{
							v1.ResourceCPU: *resource.NewMilliQuantity(int64(0), resource.DecimalSI),
							// 256
							v1.ResourceMemory: *resource.NewQuantity(int64(0), resource.BinarySI),
						},
					},
				},
			},
			InitContainers: []v1.Container{
				{
					Name:         "init",
					Image:        "alpine",
					Command:      initCommand,
					VolumeMounts: volumeMounts,
				},
			},
			Volumes: volumes,
		},
	}
	return pod
}

func (j *JobRunner) TaskStatusChannel() <-chan *TaskStatus {
	return j.taskStatusCh
}

func (j *JobRunner) Inited() bool {
	return j.inited.Load()
}

func (j *JobRunner) Close() {
	select {
	case <-j.closeCh:
	default:
		close(j.closeCh)
		j.waitGroup.Wait()
	}
}

// Pod status watcher code
//
//w, err := j.clientset.CoreV1().Pods(j.namespace).Watch(c, metav1.ListOptions{FieldSelector: "metadata.name=" + pod.Name})
//if err != nil {
//j.Errorf(err.Error())
//return
//}
//defer w.Stop()
//wg := sync.WaitGroup{}
//wg.Add(1)
//go func() {
//	defer wg.Done()
//	fmt.Println("Watching pod")
//	for {
//		select {
//		case event := <-w.ResultChan():
//			status := event.Object.(*v1.Pod).Status
//			p, _ := j.clientset.CoreV1().Pods(j.namespace).Get(c, pod.Name, metav1.GetOptions{})
//			status = p.Status
//			bytes, _ := json.Marshal(status)
//			j.Infof("Pod %s Status %s : %v\n%s", pod.Name, event.Type, status.Phase, string(bytes))
//
//			if status.Phase == v1.PodSucceeded || status.Phase == v1.PodFailed {
//				err := j.clientset.CoreV1().Pods(j.namespace).Delete(c, pod.Name, metav1.DeleteOptions{})
//				if err != nil {
//					j.Infof("Error deleting pod: %v", err)
//				}
//				return
//			}
//		}
//	}
//}()
//wg.Wait()
