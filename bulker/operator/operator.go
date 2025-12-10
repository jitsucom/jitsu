package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"sync"
	"time"

	"github.com/jitsucom/bulker/jitsubase/appbase"
	"github.com/jitsucom/bulker/jitsubase/logging"
	"github.com/jitsucom/bulker/jitsubase/safego"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/client-go/kubernetes"
)

const (
	labelApp              = "app"
	labelWorkspaceID      = "jitsu.com/workspace-id"
	labelConfigHash       = "jitsu.com/config-hash"
	labelConfigType       = "jitsu.com/config-type"
	labelFunctionsPartIdx = "jitsu.com/functions-part"
	appName               = "functions-server"
	connectionsCMSuffix   = "-fs-connections"
	functionsCMSuffix     = "-fs-functions"
	deploymentSuffix      = "-fs"

	// ConfigMap size limit (1MB with some buffer for metadata)
	maxConfigMapSize = 900 * 1024
)

type Operator struct {
	appbase.Service
	config    *Config
	clientset *kubernetes.Clientset

	connectionsRepo appbase.Repository[ConnectionsData]
	functionsRepo   appbase.Repository[FunctionsData]
	workspacesRepo  appbase.Repository[WorkspacesData]

	// Track deployed workspaces
	deployedWorkspaces map[string]*WorkspaceData
	mu                 sync.RWMutex

	closed chan struct{}
}

func NewOperator(ctx *Context) (*Operator, error) {
	clientset, _, err := GetK8SClientSet(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to create kubernetes clientset: %v", err)
	}

	op := &Operator{
		Service:            appbase.NewServiceBase("operator"),
		config:             ctx.config,
		clientset:          clientset,
		deployedWorkspaces: make(map[string]*WorkspaceData),
		closed:             make(chan struct{}),
	}

	// Initialize repositories
	op.connectionsRepo = NewConnectionsRepository(
		ctx.config.RepositoryBaseURL,
		ctx.config.RepositoryAuthToken,
		ctx.config.RepositoryRefreshPeriodSec,
		ctx.config.RepositoryCacheDir,
	)

	op.functionsRepo = NewFunctionsRepository(
		ctx.config.RepositoryBaseURL,
		ctx.config.RepositoryAuthToken,
		ctx.config.RepositoryRefreshPeriodSec,
		ctx.config.RepositoryCacheDir,
	)

	op.workspacesRepo = NewWorkspacesRepository(
		ctx.config.RepositoryBaseURL,
		ctx.config.RepositoryAuthToken,
		ctx.config.RepositoryRefreshPeriodSec,
		ctx.config.RepositoryCacheDir,
	)

	return op, nil
}

func (o *Operator) Start() {
	// Wait for initial load
	for !o.connectionsRepo.Loaded() || !o.functionsRepo.Loaded() || !o.workspacesRepo.Loaded() {
		logging.Infof("Waiting for repositories to load...")
		time.Sleep(1 * time.Second)
	}

	logging.Infof("Repositories loaded, starting operator loop")

	// Initial reconciliation
	o.reconcile()

	// Watch for changes
	safego.RunWithRestart(func() {
		connChanges := o.connectionsRepo.ChangesChannel()
		funcChanges := o.functionsRepo.ChangesChannel()
		wsChanges := o.workspacesRepo.ChangesChannel()

		for {
			select {
			case <-connChanges:
				logging.Infof("Connections changed, reconciling...")
				o.reconcile()
			case <-funcChanges:
				logging.Infof("Functions changed, reconciling...")
				o.reconcile()
			case <-wsChanges:
				logging.Infof("Workspaces changed, reconciling...")
				o.reconcile()
			case <-o.closed:
				return
			}
		}
	})
}

func (o *Operator) Close() error {
	close(o.closed)
	_ = o.connectionsRepo.Close()
	_ = o.functionsRepo.Close()
	_ = o.workspacesRepo.Close()
	return nil
}

func (o *Operator) reconcile() {
	o.mu.Lock()
	defer o.mu.Unlock()

	connData := o.connectionsRepo.GetData()
	funcData := o.functionsRepo.GetData()
	wsData := o.workspacesRepo.GetData()

	if connData == nil || funcData == nil || wsData == nil {
		logging.Warnf("Repository data not ready yet")
		return
	}

	// Find workspaces with dedicated functions server
	dedicatedWorkspaces := make(map[string]*WorkspaceData)

	for _, ws := range wsData.workspaces {
		if o.hasDedicatedFeature(ws) {
			connections := connData.byWorkspace[ws.ID]
			functions := funcData.byWorkspace[ws.ID]

			wsData := CalculateWorkspaceData(ws.ID, connections, functions, true)
			dedicatedWorkspaces[ws.ID] = wsData
		}
	}

	// Reconcile: create/update deployments for dedicated workspaces
	for workspaceID, wsData := range dedicatedWorkspaces {
		existing, exists := o.deployedWorkspaces[workspaceID]

		if !exists {
			// Create new deployment
			logging.Infof("Creating deployment for workspace %s", workspaceID)
			if err := o.createDeployment(wsData); err != nil {
				logging.Errorf("Failed to create deployment for workspace %s: %v", workspaceID, err)
				continue
			}
			o.deployedWorkspaces[workspaceID] = wsData
		} else if existing.ConfigHash != wsData.ConfigHash {
			// Update existing deployment
			logging.Infof("Updating deployment for workspace %s (hash changed: %s -> %s)",
				workspaceID, existing.ConfigHash, wsData.ConfigHash)
			if err := o.updateDeployment(wsData, existing); err != nil {
				logging.Errorf("Failed to update deployment for workspace %s: %v", workspaceID, err)
				continue
			}
			o.deployedWorkspaces[workspaceID] = wsData
		}
	}

	// Delete deployments for workspaces that no longer need dedicated FS
	for workspaceID := range o.deployedWorkspaces {
		if _, exists := dedicatedWorkspaces[workspaceID]; !exists {
			logging.Infof("Deleting deployment for workspace %s", workspaceID)
			existing := o.deployedWorkspaces[workspaceID]
			if err := o.deleteDeployment(workspaceID, existing.FunctionsConfigMapCount); err != nil {
				logging.Errorf("Failed to delete deployment for workspace %s: %v", workspaceID, err)
				continue
			}
			delete(o.deployedWorkspaces, workspaceID)
		}
	}
}

func (o *Operator) hasDedicatedFeature(ws *WorkspaceConfig) bool {
	return slices.Contains(ws.FeaturesEnabled, o.config.DedicatedFeatureFlag)
}

func (o *Operator) createDeployment(wsData *WorkspaceData) error {
	ctx := context.Background()

	// Create connections ConfigMap
	if err := o.createOrUpdateConnectionsConfigMap(ctx, wsData); err != nil {
		return fmt.Errorf("failed to create connections configmap: %v", err)
	}

	// Create functions ConfigMaps (may be multiple if data exceeds 1MB)
	numFunctionsCMs, err := o.createOrUpdateFunctionsConfigMaps(ctx, wsData)
	if err != nil {
		return fmt.Errorf("failed to create functions configmaps: %v", err)
	}
	wsData.FunctionsConfigMapCount = numFunctionsCMs

	// Create Deployment
	deployment := o.buildDeployment(wsData)
	_, err = o.clientset.AppsV1().Deployments(o.config.KubernetesNamespace).Create(ctx, deployment, metav1.CreateOptions{})
	if err != nil {
		if errors.IsAlreadyExists(err) {
			_, err = o.clientset.AppsV1().Deployments(o.config.KubernetesNamespace).Update(ctx, deployment, metav1.UpdateOptions{})
		}
		if err != nil {
			return fmt.Errorf("failed to create/update deployment: %v", err)
		}
	}

	return nil
}

func (o *Operator) updateDeployment(wsData *WorkspaceData, existing *WorkspaceData) error {
	ctx := context.Background()

	// Update connections ConfigMap
	if err := o.createOrUpdateConnectionsConfigMap(ctx, wsData); err != nil {
		return fmt.Errorf("failed to update connections configmap: %v", err)
	}

	// Update functions ConfigMaps
	numFunctionsCMs, err := o.createOrUpdateFunctionsConfigMaps(ctx, wsData)
	if err != nil {
		return fmt.Errorf("failed to update functions configmaps: %v", err)
	}

	// Delete old functions ConfigMaps if count decreased
	if existing != nil && existing.FunctionsConfigMapCount > numFunctionsCMs {
		for i := numFunctionsCMs; i < existing.FunctionsConfigMapCount; i++ {
			cmName := fmt.Sprintf("%s%s-%d", wsData.WorkspaceID, functionsCMSuffix, i)
			err := o.clientset.CoreV1().ConfigMaps(o.config.KubernetesNamespace).Delete(ctx, cmName, metav1.DeleteOptions{})
			if err != nil && !errors.IsNotFound(err) {
				logging.Warnf("Failed to delete old functions configmap %s: %v", cmName, err)
			}
		}
	}
	wsData.FunctionsConfigMapCount = numFunctionsCMs

	// Update Deployment
	deployment := o.buildDeployment(wsData)
	_, err = o.clientset.AppsV1().Deployments(o.config.KubernetesNamespace).Update(ctx, deployment, metav1.UpdateOptions{})
	if err != nil {
		return fmt.Errorf("failed to update deployment: %v", err)
	}

	return nil
}

func (o *Operator) deleteDeployment(workspaceID string, functionsConfigMapCount int) error {
	ctx := context.Background()

	deploymentName := workspaceID + deploymentSuffix
	connectionsCMName := workspaceID + connectionsCMSuffix

	// Delete Deployment
	err := o.clientset.AppsV1().Deployments(o.config.KubernetesNamespace).Delete(ctx, deploymentName, metav1.DeleteOptions{})
	if err != nil && !errors.IsNotFound(err) {
		return fmt.Errorf("failed to delete deployment: %v", err)
	}

	// Delete connections ConfigMap
	err = o.clientset.CoreV1().ConfigMaps(o.config.KubernetesNamespace).Delete(ctx, connectionsCMName, metav1.DeleteOptions{})
	if err != nil && !errors.IsNotFound(err) {
		return fmt.Errorf("failed to delete connections configmap: %v", err)
	}

	// Delete all functions ConfigMaps
	for i := 0; i < functionsConfigMapCount; i++ {
		cmName := fmt.Sprintf("%s%s-%d", workspaceID, functionsCMSuffix, i)
		err = o.clientset.CoreV1().ConfigMaps(o.config.KubernetesNamespace).Delete(ctx, cmName, metav1.DeleteOptions{})
		if err != nil && !errors.IsNotFound(err) {
			logging.Warnf("Failed to delete functions configmap %s: %v", cmName, err)
		}
	}

	return nil
}

func (o *Operator) createOrUpdateConnectionsConfigMap(ctx context.Context, wsData *WorkspaceData) error {
	configMapName := wsData.WorkspaceID + connectionsCMSuffix

	// Prepare connections data as regular JSON files
	connectionsData := make(map[string]string)
	for _, conn := range wsData.Connections {
		data, err := json.Marshal(conn)
		if err != nil {
			return fmt.Errorf("failed to marshal connection %s: %v", conn.ID, err)
		}
		connectionsData[conn.ID+".json"] = string(data)
	}

	configMap := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:      configMapName,
			Namespace: o.config.KubernetesNamespace,
			Labels: map[string]string{
				labelApp:         appName,
				labelWorkspaceID: wsData.WorkspaceID,
				labelConfigType:  "connections",
			},
		},
		Data: connectionsData,
	}

	_, err := o.clientset.CoreV1().ConfigMaps(o.config.KubernetesNamespace).Get(ctx, configMapName, metav1.GetOptions{})
	if err != nil {
		if errors.IsNotFound(err) {
			_, err = o.clientset.CoreV1().ConfigMaps(o.config.KubernetesNamespace).Create(ctx, configMap, metav1.CreateOptions{})
		}
	} else {
		_, err = o.clientset.CoreV1().ConfigMaps(o.config.KubernetesNamespace).Update(ctx, configMap, metav1.UpdateOptions{})
	}

	return err
}

// gzipCompress compresses data using gzip
func gzipCompress(data []byte) ([]byte, error) {
	var buf bytes.Buffer
	gw := gzip.NewWriter(&buf)
	_, err := gw.Write(data)
	if err != nil {
		return nil, err
	}
	if err := gw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func (o *Operator) createOrUpdateFunctionsConfigMaps(ctx context.Context, wsData *WorkspaceData) (int, error) {
	// Prepare functions data as gzip-compressed binary
	type functionEntry struct {
		id   string
		data []byte
	}
	entries := make([]functionEntry, 0, len(wsData.Functions))

	for _, fn := range wsData.Functions {
		data, err := json.Marshal(fn)
		if err != nil {
			return 0, fmt.Errorf("failed to marshal function %s: %v", fn.ID, err)
		}
		compressed, err := gzipCompress(data)
		if err != nil {
			return 0, fmt.Errorf("failed to compress function %s: %v", fn.ID, err)
		}
		entries = append(entries, functionEntry{id: fn.ID, data: compressed})
	}

	// Split into multiple ConfigMaps if needed
	configMaps := make([]*corev1.ConfigMap, 0)
	currentData := make(map[string][]byte)
	currentSize := 0
	partIdx := 0

	createConfigMap := func() {
		cmName := fmt.Sprintf("%s%s-%d", wsData.WorkspaceID, functionsCMSuffix, partIdx)
		configMaps = append(configMaps, &corev1.ConfigMap{
			ObjectMeta: metav1.ObjectMeta{
				Name:      cmName,
				Namespace: o.config.KubernetesNamespace,
				Labels: map[string]string{
					labelApp:              appName,
					labelWorkspaceID:      wsData.WorkspaceID,
					labelConfigType:       "functions",
					labelFunctionsPartIdx: fmt.Sprintf("%d", partIdx),
				},
			},
			BinaryData: currentData,
		})
		currentData = make(map[string][]byte)
		currentSize = 0
		partIdx++
	}

	for _, entry := range entries {
		entrySize := len(entry.data) + len(entry.id) + 10 // account for key overhead

		// If adding this entry would exceed limit, create new ConfigMap
		if currentSize > 0 && currentSize+entrySize > maxConfigMapSize {
			createConfigMap()
		}

		currentData[entry.id+".json.gz"] = entry.data
		currentSize += entrySize
	}

	// Create final ConfigMap if there's remaining data
	if len(currentData) > 0 {
		createConfigMap()
	}

	// If no functions, create one empty ConfigMap
	if len(configMaps) == 0 {
		cmName := fmt.Sprintf("%s%s-0", wsData.WorkspaceID, functionsCMSuffix)
		configMaps = append(configMaps, &corev1.ConfigMap{
			ObjectMeta: metav1.ObjectMeta{
				Name:      cmName,
				Namespace: o.config.KubernetesNamespace,
				Labels: map[string]string{
					labelApp:              appName,
					labelWorkspaceID:      wsData.WorkspaceID,
					labelConfigType:       "functions",
					labelFunctionsPartIdx: "0",
				},
			},
			BinaryData: make(map[string][]byte),
		})
	}

	// Create or update each ConfigMap
	for _, cm := range configMaps {
		_, err := o.clientset.CoreV1().ConfigMaps(o.config.KubernetesNamespace).Get(ctx, cm.Name, metav1.GetOptions{})
		if err != nil {
			if errors.IsNotFound(err) {
				_, err = o.clientset.CoreV1().ConfigMaps(o.config.KubernetesNamespace).Create(ctx, cm, metav1.CreateOptions{})
			}
		} else {
			_, err = o.clientset.CoreV1().ConfigMaps(o.config.KubernetesNamespace).Update(ctx, cm, metav1.UpdateOptions{})
		}
		if err != nil {
			return 0, fmt.Errorf("failed to create/update functions configmap %s: %v", cm.Name, err)
		}
	}

	return len(configMaps), nil
}

func (o *Operator) buildDeployment(wsData *WorkspaceData) *appsv1.Deployment {
	deploymentName := wsData.WorkspaceID + deploymentSuffix
	connectionsCMName := wsData.WorkspaceID + connectionsCMSuffix

	replicas := int32(1)
	connectionsVolumeName := "connections"
	connectionsMountPath := "/data/connections"
	functionsMountPath := "/data/functions"

	// Build volumes and volume mounts
	volumes := []corev1.Volume{
		{
			Name: connectionsVolumeName,
			VolumeSource: corev1.VolumeSource{
				ConfigMap: &corev1.ConfigMapVolumeSource{
					LocalObjectReference: corev1.LocalObjectReference{
						Name: connectionsCMName,
					},
				},
			},
		},
	}

	volumeMounts := []corev1.VolumeMount{
		{
			Name:      connectionsVolumeName,
			MountPath: connectionsMountPath,
			ReadOnly:  true,
		},
	}

	// Add volumes for each functions ConfigMap
	for i := 0; i < wsData.FunctionsConfigMapCount; i++ {
		volName := fmt.Sprintf("functions-%d", i)
		cmName := fmt.Sprintf("%s%s-%d", wsData.WorkspaceID, functionsCMSuffix, i)

		volumes = append(volumes, corev1.Volume{
			Name: volName,
			VolumeSource: corev1.VolumeSource{
				ConfigMap: &corev1.ConfigMapVolumeSource{
					LocalObjectReference: corev1.LocalObjectReference{
						Name: cmName,
					},
				},
			},
		})

		// Mount all functions ConfigMaps to the same directory
		// Kubernetes will merge files from multiple ConfigMaps
		volumeMounts = append(volumeMounts, corev1.VolumeMount{
			Name:      volName,
			MountPath: fmt.Sprintf("%s/part-%d", functionsMountPath, i),
			ReadOnly:  true,
		})
	}

	podSpec := corev1.PodSpec{
		Containers: []corev1.Container{
			{
				Name:  appName,
				Image: o.config.FunctionsServerImage,
				Ports: []corev1.ContainerPort{
					{
						ContainerPort: int32(o.config.FunctionsServerPort),
						Protocol:      corev1.ProtocolTCP,
					},
				},
				Env: []corev1.EnvVar{
					{
						Name:  "CONFIG_DIR",
						Value: "/data",
					},
					{
						Name:  "ROTOR_MODE",
						Value: "functions",
					},
					{
						Name:  "PORT",
						Value: fmt.Sprintf("%d", o.config.FunctionsServerPort),
					},
				},
				VolumeMounts: volumeMounts,
				LivenessProbe: &corev1.Probe{
					ProbeHandler: corev1.ProbeHandler{
						HTTPGet: &corev1.HTTPGetAction{
							Path: "/health",
							Port: intstr.FromInt(o.config.FunctionsServerPort),
						},
					},
					InitialDelaySeconds: 10,
					PeriodSeconds:       30,
				},
				ReadinessProbe: &corev1.Probe{
					ProbeHandler: corev1.ProbeHandler{
						HTTPGet: &corev1.HTTPGetAction{
							Path: "/health",
							Port: intstr.FromInt(o.config.FunctionsServerPort),
						},
					},
					InitialDelaySeconds: 5,
					PeriodSeconds:       10,
				},
			},
		},
		Volumes: volumes,
	}

	// Add service account if configured
	if o.config.PodsServiceAccount != "" {
		podSpec.ServiceAccountName = o.config.PodsServiceAccount
	}

	return &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      deploymentName,
			Namespace: o.config.KubernetesNamespace,
			Labels: map[string]string{
				labelApp:         appName,
				labelWorkspaceID: wsData.WorkspaceID,
			},
		},
		Spec: appsv1.DeploymentSpec{
			Replicas: &replicas,
			Selector: &metav1.LabelSelector{
				MatchLabels: map[string]string{
					labelApp:         appName,
					labelWorkspaceID: wsData.WorkspaceID,
				},
			},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{
					Labels: map[string]string{
						labelApp:         appName,
						labelWorkspaceID: wsData.WorkspaceID,
					},
					Annotations: map[string]string{
						labelConfigHash: wsData.ConfigHash,
					},
				},
				Spec: podSpec,
			},
		},
	}
}
