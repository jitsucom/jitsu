package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/hjson/hjson-go/v4"
	"github.com/jitsucom/bulker/jitsubase/appbase"
	"github.com/jitsucom/bulker/jitsubase/logging"
	"github.com/jitsucom/bulker/jitsubase/safego"
	"github.com/jitsucom/bulker/jitsubase/utils"
	appsv1 "k8s.io/api/apps/v1"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/client-go/kubernetes"
)

const (
	labelApp                = "app"
	labelWorkspaceID        = "jitsu.com/workspace-id"
	labelWorkspaceIDs       = "jitsu.com/workspace-ids" // For multi-workspace deployments (annotation, comma-separated)
	annotationPromScrape    = "prometheus.io/scrape"
	labelConfigHash         = "jitsu.com/config-hash"
	labelOperatorConfigHash = "jitsu.com/operator-config-hash"
	labelConfigType         = "jitsu.com/config-type"
	labelFunctionsClass     = "jitsu.com/functions-class"
	labelConfigPartIdx      = "jitsu.com/config-part"
	appName                 = "functions-server"
	connectionsCMSuffix     = "-fs-connections"
	functionsCMSuffix       = "-fs-functions"
	deploymentSuffix        = "-fs"
	servicePrefix           = "fs-" // Prefix to ensure service name starts with letter (workspaceId may start with number)

	// ConfigMap size limit (1MB with some buffer for metadata)
	maxConfigMapSize = 900 * 1024

	// Functions class values
	FunctionsClassDedicated = "dedicated" // One deployment per workspace
	FunctionsClassFree      = "free"      // All workspaces share one deployment
	FunctionsClassPremium   = "premium"   // Premium tier with dedicated resources
	FunctionsClassLegacy    = "legacy"    // Ignored by operator

	// Special deployment name for free tier
	freeDeploymentName = "free-fs"
	freeServiceName    = "fs-free"
	// HPA suffix
	hpaSuffix = "-fs-hpa"
)

type Operator struct {
	appbase.Service
	config    *Config
	clientset *kubernetes.Clientset

	connectionsRepo appbase.Repository[ConnectionsData]
	functionsRepo   appbase.Repository[FunctionsData]
	workspacesRepo  appbase.Repository[WorkspacesData]

	closed chan struct{}
}

func NewOperator(ctx *Context) (*Operator, error) {
	clientset, _, err := GetK8SClientSet(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to create kubernetes clientset: %v", err)
	}

	op := &Operator{
		Service:   appbase.NewServiceBase("operator"),
		config:    ctx.config,
		clientset: clientset,
		closed:    make(chan struct{}),
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
	ctx := context.Background()

	connData := o.connectionsRepo.GetData()
	funcData := o.functionsRepo.GetData()
	wsData := o.workspacesRepo.GetData()

	if connData == nil || funcData == nil || wsData == nil {
		logging.Warnf("Repository data not ready yet")
		return
	}

	// Get existing deployments from K8s
	existingDeployments, err := o.getExistingDeployments(ctx)
	if err != nil {
		logging.Errorf("Failed to get existing deployments: %v", err)
		return
	}

	// Group workspaces by functions class
	dedicatedWorkspaces := make(map[string]*WorkspaceData) // workspaceID -> WorkspaceData
	freeWorkspaces := make([]*WorkspaceData, 0)

	for _, ws := range wsData.workspaces {
		functionsClasses := o.getFunctionsClasses(ws)

		// Skip legacy and unknown classes
		if !slices.Contains(functionsClasses, FunctionsClassPremium) && !slices.Contains(functionsClasses, FunctionsClassDedicated) && !slices.Contains(functionsClasses, FunctionsClassFree) {
			continue
		}

		connections := connData.byWorkspace[ws.ID]
		functions := funcData.byWorkspace[ws.ID]

		// Skip workspaces without connections or functions
		if len(connections) == 0 || len(functions) == 0 {
			continue
		}

		wsWorkspaceData := CalculateWorkspaceData(ws.ID, connections, functions, true)

		if slices.Contains(functionsClasses, FunctionsClassPremium) || slices.Contains(functionsClasses, FunctionsClassDedicated) {
			wData := *wsWorkspaceData // Copy
			wData.FunctionsClass = utils.Ternary(slices.Contains(functionsClasses, FunctionsClassPremium), FunctionsClassPremium, FunctionsClassDedicated)
			dedicatedWorkspaces[ws.ID] = &wData
		}
		if slices.Contains(functionsClasses, FunctionsClassFree) {
			freeWorkspaces = append(freeWorkspaces, wsWorkspaceData)
		}
	}

	// Build desired deployments map
	desiredDeployments := make(map[string]*DeploymentData)
	operatorConfigHash := o.config.CalculateOperatorConfigHash()

	// Add dedicated deployments (one per workspace)
	for workspaceID, wsData := range dedicatedWorkspaces {
		desiredDeployments[workspaceID] = &DeploymentData{
			DeploymentID:       workspaceID,
			FunctionsClass:     wsData.FunctionsClass,
			WorkspaceIDs:       []string{workspaceID},
			Connections:        wsData.Connections,
			Functions:          wsData.Functions,
			ConfigHash:         wsData.ConfigHash,
			OperatorConfigHash: operatorConfigHash,
		}
	}

	// Add free deployment (all free workspaces share one deployment)
	if len(freeWorkspaces) > 0 {
		freeDeployment := o.buildFreeDeploymentData(freeWorkspaces)
		freeDeployment.OperatorConfigHash = operatorConfigHash
		desiredDeployments[FunctionsClassFree] = freeDeployment
	}

	// Reconcile: create/update deployments
	for deploymentID, deploymentData := range desiredDeployments {
		existing, exists := existingDeployments[deploymentID]

		if !exists {
			// Create new deployment
			logging.Infof("Creating deployment %s (class: %s, workspaces: %v)",
				deploymentID, deploymentData.FunctionsClass, deploymentData.WorkspaceIDs)
			if err := o.createDeploymentFromData(deploymentData); err != nil {
				logging.Errorf("Failed to create deployment %s: %v", deploymentID, err)
				continue
			}
		} else {
			// Update existing deployment
			needDeploy := false
			if existing.ConfigHash != deploymentData.ConfigHash {
				needDeploy = true
				logging.Infof("Updating deployment %s (hash changed: %s -> %s)",
					deploymentID, existing.ConfigHash, deploymentData.ConfigHash)
			} else if existing.OperatorConfigHash != deploymentData.OperatorConfigHash {
				needDeploy = true
				logging.Infof("Updating deployment %s (operator config changed: %s -> %s)",
					deploymentID, existing.OperatorConfigHash, deploymentData.OperatorConfigHash)
			}
			if needDeploy {
				if err := o.updateDeploymentFromData(deploymentData, existing); err != nil {
					logging.Errorf("Failed to update deployment %s: %v", deploymentID, err)
					continue
				}
			}
		}
	}

	// Delete deployments that are no longer needed
	for deploymentID, existing := range existingDeployments {
		if _, exists := desiredDeployments[deploymentID]; !exists {
			logging.Infof("Deleting deployment %s", deploymentID)
			if err := o.deleteDeploymentByID(deploymentID, existing); err != nil {
				logging.Errorf("Failed to delete deployment %s: %v", deploymentID, err)
				continue
			}
		}
	}
}

// getExistingDeployments queries K8s for existing functions-server deployments
// and returns a map of deploymentID -> DeploymentData (with ConfigHash and CM counts)
func (o *Operator) getExistingDeployments(ctx context.Context) (map[string]*DeploymentData, error) {
	result := make(map[string]*DeploymentData)

	// List all deployments with our app label
	deployments, err := o.clientset.AppsV1().Deployments(o.config.KubernetesNamespace).List(ctx, metav1.ListOptions{
		LabelSelector: fmt.Sprintf("%s=%s", labelApp, appName),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list deployments: %v", err)
	}

	// List all ConfigMaps to count them per deployment
	configMaps, err := o.clientset.CoreV1().ConfigMaps(o.config.KubernetesNamespace).List(ctx, metav1.ListOptions{
		LabelSelector: fmt.Sprintf("%s=%s", labelApp, appName),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list configmaps: %v", err)
	}

	// Count ConfigMaps per deployment
	functionsCMCount := make(map[string]int)
	connectionsCMCount := make(map[string]int)
	for _, cm := range configMaps.Items {
		configType := cm.Labels[labelConfigType]
		// For dedicated deployments, use workspaceID; for free, use functions class
		deploymentID := cm.Labels[labelWorkspaceID]
		if functionsClass := cm.Labels[labelFunctionsClass]; functionsClass == FunctionsClassFree {
			deploymentID = FunctionsClassFree
		}
		if deploymentID != "" {
			switch configType {
			case "functions":
				functionsCMCount[deploymentID]++
			case "connections":
				connectionsCMCount[deploymentID]++
			}
		}
	}

	// Build deployment data from K8s deployments
	for _, deployment := range deployments.Items {
		functionsClass := deployment.Labels[labelFunctionsClass]
		var deploymentID string
		var workspaceIDs []string

		if functionsClass == FunctionsClassFree {
			deploymentID = FunctionsClassFree
			if wsIDs := deployment.Annotations[labelWorkspaceIDs]; wsIDs != "" {
				workspaceIDs = strings.Split(wsIDs, ",")
			}
		} else {
			deploymentID = deployment.Labels[labelWorkspaceID]
			if deploymentID == "" {
				logging.Warnf("Deployment %s has no workspace ID label, skipping", deployment.Name)
				continue
			}
			workspaceIDs = []string{deploymentID}
		}

		// Get config hash from pod template annotations
		configHash := ""
		operatorConfigHash := ""
		if deployment.Spec.Template.Annotations != nil {
			configHash = deployment.Spec.Template.Annotations[labelConfigHash]
			operatorConfigHash = deployment.Spec.Template.Annotations[labelOperatorConfigHash]
		}

		// Get ConfigMap counts for this deployment
		funcsCMCount := functionsCMCount[deploymentID]
		if funcsCMCount == 0 {
			funcsCMCount = 1
		}
		connsCMCount := connectionsCMCount[deploymentID]
		if connsCMCount == 0 {
			connsCMCount = 1
		}

		result[deploymentID] = &DeploymentData{
			DeploymentID:              deploymentID,
			FunctionsClass:            functionsClass,
			WorkspaceIDs:              workspaceIDs,
			ConfigHash:                configHash,
			OperatorConfigHash:        operatorConfigHash,
			ConnectionsConfigMapCount: connsCMCount,
			FunctionsConfigMapCount:   funcsCMCount,
		}
	}

	return result, nil
}

// buildFreeDeploymentData aggregates all free workspaces into a single deployment
func (o *Operator) buildFreeDeploymentData(workspaces []*WorkspaceData) *DeploymentData {
	var allConnections []*EnrichedConnectionConfig
	var allFunctions []*FunctionConfig
	workspaceIDs := make([]string, 0, len(workspaces))

	for _, ws := range workspaces {
		workspaceIDs = append(workspaceIDs, ws.WorkspaceID)
		allConnections = append(allConnections, ws.Connections...)
		allFunctions = append(allFunctions, ws.Functions...)
	}

	// Sort workspace IDs for consistent hash
	sort.Strings(workspaceIDs)

	// Calculate combined hash
	configHash := CalculateConfigHash(allConnections, allFunctions)

	return &DeploymentData{
		DeploymentID:   FunctionsClassFree,
		FunctionsClass: FunctionsClassFree,
		WorkspaceIDs:   workspaceIDs,
		Connections:    allConnections,
		Functions:      allFunctions,
		ConfigHash:     configHash,
	}
}

// getFunctionsClasses returns the functions class for a workspace based on feature flags.
// Format: ${FunctionsClassFeatureFlag}=<value> where value is dedicated, free, or legacy.
// Returns empty string if no matching feature flag is found (uses default).
func (o *Operator) getFunctionsClasses(ws *WorkspaceConfig) []string {
	prefix := o.config.FunctionsClassFeatureFlag + "="
	for _, feature := range ws.FeaturesEnabled {
		if strings.HasPrefix(feature, prefix) {
			return utils.ArrayMap(strings.Split(strings.TrimPrefix(feature, prefix), ","), strings.TrimSpace)
		}
	}
	// Return default if no feature flag found
	return []string{o.config.DefaultFunctionsClass}
}

// createOrUpdateMongobetweenConfigMap creates/updates the mongobetween config ConfigMap
// containing the allowed-collections.txt file
func (o *Operator) createOrUpdateMongobetweenConfigMap(ctx context.Context, data *DeploymentData) error {
	if o.config.MongoDBURL == "" {
		return nil // MongoDB not configured, skip
	}

	cmName := fmt.Sprintf("%s-mongobetween", data.DeploymentID)
	allowedCollections := o.buildAllowedCollectionsFileContent(data.WorkspaceIDs)

	cm := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:      cmName,
			Namespace: o.config.KubernetesNamespace,
			Labels: map[string]string{
				labelApp:            appName,
				labelFunctionsClass: data.FunctionsClass,
				labelConfigType:     "mongobetween",
			},
			Annotations: map[string]string{
				labelWorkspaceIDs: strings.Join(data.WorkspaceIDs, ","),
			},
		},
		Data: map[string]string{
			"allowed-collections.txt": allowedCollections,
		},
	}

	_, err := o.clientset.CoreV1().ConfigMaps(o.config.KubernetesNamespace).Get(ctx, cmName, metav1.GetOptions{})
	if err != nil {
		if errors.IsNotFound(err) {
			_, err = o.clientset.CoreV1().ConfigMaps(o.config.KubernetesNamespace).Create(ctx, cm, metav1.CreateOptions{})
		}
	} else {
		_, err = o.clientset.CoreV1().ConfigMaps(o.config.KubernetesNamespace).Update(ctx, cm, metav1.UpdateOptions{})
	}
	if err != nil {
		return fmt.Errorf("failed to create/update mongobetween configmap %s: %v", cmName, err)
	}

	return nil
}

// deleteMongobetweenConfigMap deletes the mongobetween config ConfigMap
func (o *Operator) deleteMongobetweenConfigMap(ctx context.Context, deploymentID string) error {
	if o.config.MongoDBURL == "" {
		return nil // MongoDB not configured, skip
	}

	cmName := fmt.Sprintf("%s-mongobetween", deploymentID)
	err := o.clientset.CoreV1().ConfigMaps(o.config.KubernetesNamespace).Delete(ctx, cmName, metav1.DeleteOptions{})
	if err != nil && !errors.IsNotFound(err) {
		return fmt.Errorf("failed to delete mongobetween configmap %s: %v", cmName, err)
	}
	return nil
}

func (o *Operator) createDeploymentFromData(data *DeploymentData) error {
	ctx := context.Background()

	// Create connections ConfigMaps (may be multiple if data exceeds 1MB for free tier)
	numConnectionsCMs, err := o.createOrUpdateConnectionsConfigMaps(ctx, data)
	if err != nil {
		return fmt.Errorf("failed to create connections configmaps: %v", err)
	}
	data.ConnectionsConfigMapCount = numConnectionsCMs

	// Create functions ConfigMaps (may be multiple if data exceeds 1MB)
	numFunctionsCMs, err := o.createOrUpdateFunctionsConfigMapsFromData(ctx, data)
	if err != nil {
		return fmt.Errorf("failed to create functions configmaps: %v", err)
	}
	data.FunctionsConfigMapCount = numFunctionsCMs

	// Create mongobetween ConfigMap if MongoDB is configured
	if err := o.createOrUpdateMongobetweenConfigMap(ctx, data); err != nil {
		return fmt.Errorf("failed to create mongobetween configmap: %v", err)
	}

	// Create Deployment
	deployment := o.buildDeploymentFromData(data)
	_, err = o.clientset.AppsV1().Deployments(o.config.KubernetesNamespace).Create(ctx, deployment, metav1.CreateOptions{})
	if err != nil {
		if errors.IsAlreadyExists(err) {
			_, err = o.clientset.AppsV1().Deployments(o.config.KubernetesNamespace).Update(ctx, deployment, metav1.UpdateOptions{})
		}
		if err != nil {
			return fmt.Errorf("failed to create/update deployment: %v", err)
		}
	}

	// Create Service
	if err := o.createOrUpdateServiceFromData(ctx, data); err != nil {
		return fmt.Errorf("failed to create service: %v", err)
	} else {
		o.Infof("Service for deployment %s created/updated", data.DeploymentID)
	}

	// Create HPA if enabled
	if err := o.createOrUpdateHPA(ctx, data); err != nil {
		return fmt.Errorf("failed to create HPA: %v", err)
	}

	return nil
}

func (o *Operator) updateDeploymentFromData(data *DeploymentData, existing *DeploymentData) error {
	ctx := context.Background()

	// Update connections ConfigMaps
	numConnectionsCMs, err := o.createOrUpdateConnectionsConfigMaps(ctx, data)
	if err != nil {
		return fmt.Errorf("failed to update connections configmaps: %v", err)
	}

	// Delete old connections ConfigMaps if count decreased
	if existing != nil && existing.ConnectionsConfigMapCount > numConnectionsCMs {
		for i := numConnectionsCMs; i < existing.ConnectionsConfigMapCount; i++ {
			cmName := fmt.Sprintf("%s%s-%d", data.DeploymentID, connectionsCMSuffix, i)
			err := o.clientset.CoreV1().ConfigMaps(o.config.KubernetesNamespace).Delete(ctx, cmName, metav1.DeleteOptions{})
			if err != nil && !errors.IsNotFound(err) {
				logging.Warnf("Failed to delete old connections configmap %s: %v", cmName, err)
			}
		}
	}

	// Delete ExternalName services for workspaces that are no longer in this deployment (free tier only)
	if existing != nil && existing.FunctionsClass == FunctionsClassFree {
		for _, oldWsID := range existing.WorkspaceIDs {
			found := false
			for _, newWsID := range data.WorkspaceIDs {
				if oldWsID == newWsID {
					found = true
					break
				}
			}
			if !found {
				// Delete ExternalName service for workspaces leaving free tier
				serviceName := servicePrefix + oldWsID
				err = o.clientset.CoreV1().Services(o.config.KubernetesNamespace).Delete(ctx, serviceName, metav1.DeleteOptions{})
				if err != nil && !errors.IsNotFound(err) {
					logging.Warnf("Failed to delete ExternalName service %s: %v", serviceName, err)
				}
			}
		}
	}
	data.ConnectionsConfigMapCount = numConnectionsCMs

	// Update functions ConfigMaps
	numFunctionsCMs, err := o.createOrUpdateFunctionsConfigMapsFromData(ctx, data)
	if err != nil {
		return fmt.Errorf("failed to update functions configmaps: %v", err)
	}

	// Delete old functions ConfigMaps if count decreased
	if existing != nil && existing.FunctionsConfigMapCount > numFunctionsCMs {
		for i := numFunctionsCMs; i < existing.FunctionsConfigMapCount; i++ {
			cmName := fmt.Sprintf("%s%s-%d", data.DeploymentID, functionsCMSuffix, i)
			err := o.clientset.CoreV1().ConfigMaps(o.config.KubernetesNamespace).Delete(ctx, cmName, metav1.DeleteOptions{})
			if err != nil && !errors.IsNotFound(err) {
				logging.Warnf("Failed to delete old functions configmap %s: %v", cmName, err)
			}
		}
	}
	data.FunctionsConfigMapCount = numFunctionsCMs

	// Update mongobetween ConfigMap if MongoDB is configured
	if err := o.createOrUpdateMongobetweenConfigMap(ctx, data); err != nil {
		return fmt.Errorf("failed to update mongobetween configmap: %v", err)
	}

	// Update Deployment
	deployment := o.buildDeploymentFromData(data)
	_, err = o.clientset.AppsV1().Deployments(o.config.KubernetesNamespace).Update(ctx, deployment, metav1.UpdateOptions{})
	if err != nil {
		return fmt.Errorf("failed to update deployment: %v", err)
	}

	// Update Service
	if err := o.createOrUpdateServiceFromData(ctx, data); err != nil {
		return fmt.Errorf("failed to update service: %v", err)
	} else {
		o.Infof("Service for deployment %s created/updated", data.DeploymentID)
	}

	// Update HPA if enabled
	if err := o.createOrUpdateHPA(ctx, data); err != nil {
		return fmt.Errorf("failed to update HPA: %v", err)
	}

	return nil
}

func (o *Operator) deleteDeploymentByID(deploymentID string, existing *DeploymentData) error {
	ctx := context.Background()

	// Determine deployment name based on class
	var deploymentName string
	if existing.FunctionsClass == FunctionsClassFree {
		deploymentName = freeDeploymentName

		// Delete the shared free-fs Service
		err := o.clientset.CoreV1().Services(o.config.KubernetesNamespace).Delete(ctx, freeDeploymentName, metav1.DeleteOptions{})
		if err != nil && !errors.IsNotFound(err) {
			return fmt.Errorf("failed to delete free service: %v", err)
		}

		// Delete per-workspace ExternalName Services
		for _, wsID := range existing.WorkspaceIDs {
			serviceName := servicePrefix + wsID
			err = o.clientset.CoreV1().Services(o.config.KubernetesNamespace).Delete(ctx, serviceName, metav1.DeleteOptions{})
			if err != nil && !errors.IsNotFound(err) {
				logging.Warnf("Failed to delete ExternalName service %s: %v", serviceName, err)
			}
		}
	} else {
		deploymentName = deploymentID + deploymentSuffix

		// Delete dedicated workspace Service
		serviceName := servicePrefix + deploymentID
		err := o.clientset.CoreV1().Services(o.config.KubernetesNamespace).Delete(ctx, serviceName, metav1.DeleteOptions{})
		if err != nil && !errors.IsNotFound(err) {
			return fmt.Errorf("failed to delete service: %v", err)
		}
	}

	// Delete Deployment
	err := o.clientset.AppsV1().Deployments(o.config.KubernetesNamespace).Delete(ctx, deploymentName, metav1.DeleteOptions{})
	if err != nil && !errors.IsNotFound(err) {
		return fmt.Errorf("failed to delete deployment: %v", err)
	}

	// Delete all connections ConfigMaps (parts-based)
	for i := 0; i < existing.ConnectionsConfigMapCount; i++ {
		cmName := fmt.Sprintf("%s%s-%d", deploymentID, connectionsCMSuffix, i)
		err = o.clientset.CoreV1().ConfigMaps(o.config.KubernetesNamespace).Delete(ctx, cmName, metav1.DeleteOptions{})
		if err != nil && !errors.IsNotFound(err) {
			logging.Warnf("Failed to delete connections configmap %s: %v", cmName, err)
		}
	}

	// Delete all functions ConfigMaps
	for i := 0; i < existing.FunctionsConfigMapCount; i++ {
		cmName := fmt.Sprintf("%s%s-%d", deploymentID, functionsCMSuffix, i)
		err = o.clientset.CoreV1().ConfigMaps(o.config.KubernetesNamespace).Delete(ctx, cmName, metav1.DeleteOptions{})
		if err != nil && !errors.IsNotFound(err) {
			logging.Warnf("Failed to delete functions configmap %s: %v", cmName, err)
		}
	}

	// Delete mongobetween ConfigMap if MongoDB is configured
	if err := o.deleteMongobetweenConfigMap(ctx, deploymentID); err != nil {
		logging.Warnf("Failed to delete mongobetween configmap: %v", err)
	}

	// Delete HPA
	if err := o.deleteHPA(ctx, deploymentID, existing.FunctionsClass); err != nil {
		logging.Warnf("Failed to delete HPA: %v", err)
	}

	return nil
}

// createOrUpdateConnectionsConfigMaps creates parts-based ConfigMaps for connections.
// Files are stored with keys like ${workspaceId}__connections.json.gz
// This structure is shared by both dedicated and free tier deployments.
func (o *Operator) createOrUpdateConnectionsConfigMaps(ctx context.Context, data *DeploymentData) (int, error) {
	// Group connections by workspace
	connectionsByWorkspace := make(map[string][]*EnrichedConnectionConfig)
	for _, conn := range data.Connections {
		connectionsByWorkspace[conn.WorkspaceID] = append(connectionsByWorkspace[conn.WorkspaceID], conn)
	}
	// Prepare all connection entries with workspace prefix
	type connectionEntry struct {
		key  string
		data []byte
	}
	entries := make([]connectionEntry, 0, len(data.WorkspaceIDs))

	for _, wsID := range data.WorkspaceIDs {
		connections := connectionsByWorkspace[wsID]
		if len(connections) == 0 {
			continue
		}

		// Marshal all connections for this workspace
		allConnections := make([]any, 0, len(connections))
		for _, conn := range connections {
			allConnections = append(allConnections, conn)
		}

		jsonData, err := json.Marshal(allConnections)
		if err != nil {
			return 0, fmt.Errorf("failed to marshal connections for workspace %s: %v", wsID, err)
		}

		compressed, err := gzipCompress(jsonData)
		if err != nil {
			return 0, fmt.Errorf("failed to compress connections for workspace %s: %v", wsID, err)
		}

		// Key includes workspaceId for directory structure
		key := fmt.Sprintf("%s__connections.json.gz", wsID)
		entries = append(entries, connectionEntry{key: key, data: compressed})
	}

	// Split into multiple ConfigMaps if needed
	configMaps := make([]*corev1.ConfigMap, 0)
	currentData := make(map[string][]byte)
	currentSize := 0
	partIdx := 0

	createConfigMap := func() {
		cmName := fmt.Sprintf("%s%s-%d", data.DeploymentID, connectionsCMSuffix, partIdx)
		configMaps = append(configMaps, &corev1.ConfigMap{
			ObjectMeta: metav1.ObjectMeta{
				Name:      cmName,
				Namespace: o.config.KubernetesNamespace,
				Labels: map[string]string{
					labelApp:            appName,
					labelFunctionsClass: data.FunctionsClass,
					labelConfigType:     "connections",
					labelConfigPartIdx:  fmt.Sprintf("%d", partIdx),
				},
				Annotations: map[string]string{
					labelWorkspaceIDs: strings.Join(data.WorkspaceIDs, ","),
				},
			},
			BinaryData: currentData,
		})
		currentData = make(map[string][]byte)
		currentSize = 0
		partIdx++
	}

	for _, entry := range entries {
		entrySize := len(entry.data) + len(entry.key) + 10 // account for key overhead

		// If adding this entry would exceed limit, create new ConfigMap
		if currentSize > 0 && currentSize+entrySize > maxConfigMapSize {
			createConfigMap()
		}

		currentData[entry.key] = entry.data
		currentSize += entrySize
	}

	// Create final ConfigMap if there's remaining data
	if len(currentData) > 0 {
		createConfigMap()
	}

	// If no connections, create one empty ConfigMap
	if len(configMaps) == 0 {
		cmName := fmt.Sprintf("%s%s-0", data.DeploymentID, connectionsCMSuffix)
		configMaps = append(configMaps, &corev1.ConfigMap{
			ObjectMeta: metav1.ObjectMeta{
				Name:      cmName,
				Namespace: o.config.KubernetesNamespace,
				Labels: map[string]string{
					labelApp:            appName,
					labelFunctionsClass: data.FunctionsClass,
					labelConfigType:     "connections",
					labelConfigPartIdx:  "0",
				},
				Annotations: map[string]string{
					labelWorkspaceIDs: strings.Join(data.WorkspaceIDs, ","),
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
			return 0, fmt.Errorf("failed to create/update connections configmap %s: %v", cm.Name, err)
		}
	}

	return len(configMaps), nil
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

// createOrUpdateFunctionsConfigMapsFromData creates functions ConfigMaps for a deployment.
// Functions are organized by workspace: ${workspaceId}/functions/part-{n}/*.json.gz
func (o *Operator) createOrUpdateFunctionsConfigMapsFromData(ctx context.Context, data *DeploymentData) (int, error) {
	// Group functions by workspace
	functionsByWorkspace := make(map[string][]*FunctionConfig)
	for _, fn := range data.Functions {
		functionsByWorkspace[fn.WorkspaceID] = append(functionsByWorkspace[fn.WorkspaceID], fn)
	}

	// Prepare all function entries with workspace prefix for directory structure
	type functionEntry struct {
		// Key format: ${workspaceId}/${functionId}.json.gz
		key  string
		data []byte
	}
	entries := make([]functionEntry, 0, len(data.Functions))

	for _, fn := range data.Functions {
		jsonData, err := json.Marshal(fn)
		if err != nil {
			return 0, fmt.Errorf("failed to marshal function %s: %v", fn.ID, err)
		}
		compressed, err := gzipCompress(jsonData)
		if err != nil {
			return 0, fmt.Errorf("failed to compress function %s: %v", fn.ID, err)
		}
		// Key includes workspaceId for directory structure
		key := fmt.Sprintf("%s__%s.json.gz", fn.WorkspaceID, fn.ID)
		entries = append(entries, functionEntry{key: key, data: compressed})
	}

	// Split into multiple ConfigMaps if needed
	configMaps := make([]*corev1.ConfigMap, 0)
	currentData := make(map[string][]byte)
	currentSize := 0
	partIdx := 0

	createConfigMap := func() {
		cmName := fmt.Sprintf("%s%s-%d", data.DeploymentID, functionsCMSuffix, partIdx)
		configMaps = append(configMaps, &corev1.ConfigMap{
			ObjectMeta: metav1.ObjectMeta{
				Name:      cmName,
				Namespace: o.config.KubernetesNamespace,
				Labels: map[string]string{
					labelApp:            appName,
					labelFunctionsClass: data.FunctionsClass,
					labelConfigType:     "functions",
					labelConfigPartIdx:  fmt.Sprintf("%d", partIdx),
				},
				Annotations: map[string]string{
					labelWorkspaceIDs: strings.Join(data.WorkspaceIDs, ","),
				},
			},
			BinaryData: currentData,
		})
		currentData = make(map[string][]byte)
		currentSize = 0
		partIdx++
	}

	for _, entry := range entries {
		entrySize := len(entry.data) + len(entry.key) + 10 // account for key overhead

		// If adding this entry would exceed limit, create new ConfigMap
		if currentSize > 0 && currentSize+entrySize > maxConfigMapSize {
			createConfigMap()
		}

		currentData[entry.key] = entry.data
		currentSize += entrySize
	}

	// Create final ConfigMap if there's remaining data
	if len(currentData) > 0 {
		createConfigMap()
	}

	// If no functions, create one empty ConfigMap
	if len(configMaps) == 0 {
		cmName := fmt.Sprintf("%s%s-0", data.DeploymentID, functionsCMSuffix)
		configMaps = append(configMaps, &corev1.ConfigMap{
			ObjectMeta: metav1.ObjectMeta{
				Name:      cmName,
				Namespace: o.config.KubernetesNamespace,
				Labels: map[string]string{
					labelApp:            appName,
					labelFunctionsClass: data.FunctionsClass,
					labelConfigType:     "functions",
					labelConfigPartIdx:  "0",
				},
				Annotations: map[string]string{
					labelWorkspaceIDs: strings.Join(data.WorkspaceIDs, ","),
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

func (o *Operator) createOrUpdateServiceFromData(ctx context.Context, data *DeploymentData) error {
	if data.FunctionsClass == FunctionsClassFree {
		// For free tier: create the shared free-fs Service
		if err := o.createOrUpdateFreeService(ctx, data); err != nil {
			return err
		}
		//// Also create per-workspace ExternalName Services pointing to free-fs
		//for _, wsID := range data.WorkspaceIDs {
		//	if err := o.createOrUpdateWorkspaceExternalNameService(ctx, wsID); err != nil {
		//		return fmt.Errorf("failed to create ExternalName service for workspace %s: %v", wsID, err)
		//	}
		//}
		return nil
	}

	// Dedicated: create ClusterIP service for the workspace
	return o.createOrUpdateDedicatedService(ctx, data)
}

// createOrUpdateFreeService creates/updates the shared free-fs Service
func (o *Operator) createOrUpdateFreeService(ctx context.Context, data *DeploymentData) error {
	serviceName := freeServiceName
	labels := map[string]string{
		labelApp:            appName,
		labelFunctionsClass: FunctionsClassFree,
	}
	selector := map[string]string{
		labelApp:            appName,
		labelFunctionsClass: FunctionsClassFree,
	}

	service := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      serviceName,
			Namespace: o.config.KubernetesNamespace,
			Labels:    labels,
			Annotations: map[string]string{
				labelWorkspaceIDs: strings.Join(data.WorkspaceIDs, ","),
			},
		},
		Spec: corev1.ServiceSpec{
			Type:     corev1.ServiceType(o.config.ServiceType),
			Selector: selector,
			Ports: []corev1.ServicePort{
				{
					Name:       "http",
					Port:       int32(o.config.FunctionsServerPort),
					TargetPort: intstr.FromInt(o.config.FunctionsServerPort),
					Protocol:   corev1.ProtocolTCP,
				},
			},
		},
	}

	existing, err := o.clientset.CoreV1().Services(o.config.KubernetesNamespace).Get(ctx, serviceName, metav1.GetOptions{})
	if err != nil {
		if errors.IsNotFound(err) {
			_, err = o.clientset.CoreV1().Services(o.config.KubernetesNamespace).Create(ctx, service, metav1.CreateOptions{})
			return err
		}
		return err
	}

	service.Spec.ClusterIP = existing.Spec.ClusterIP
	service.ResourceVersion = existing.ResourceVersion
	_, err = o.clientset.CoreV1().Services(o.config.KubernetesNamespace).Update(ctx, service, metav1.UpdateOptions{})
	return err
}

// createOrUpdateWorkspaceExternalNameService creates/updates an ExternalName Service for a workspace
// that points to the shared free-fs Service
func (o *Operator) createOrUpdateWorkspaceExternalNameService(ctx context.Context, workspaceID string) error {
	serviceName := servicePrefix + workspaceID
	// ExternalName target: free-fs.<namespace>.svc.cluster.local
	externalName := fmt.Sprintf("%s.%s.svc.cluster.local", freeServiceName, o.config.KubernetesNamespace)

	service := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      serviceName,
			Namespace: o.config.KubernetesNamespace,
			Labels: map[string]string{
				labelApp:            appName,
				labelWorkspaceID:    workspaceID,
				labelFunctionsClass: FunctionsClassFree,
			},
		},
		Spec: corev1.ServiceSpec{
			Type:         corev1.ServiceTypeExternalName,
			ExternalName: externalName,
		},
	}

	existing, err := o.clientset.CoreV1().Services(o.config.KubernetesNamespace).Get(ctx, serviceName, metav1.GetOptions{})
	if err != nil {
		if errors.IsNotFound(err) {
			_, err = o.clientset.CoreV1().Services(o.config.KubernetesNamespace).Create(ctx, service, metav1.CreateOptions{})
			return err
		}
		return err
	}

	// Update existing service - for ExternalName we need to handle type change
	service.ResourceVersion = existing.ResourceVersion
	_, err = o.clientset.CoreV1().Services(o.config.KubernetesNamespace).Update(ctx, service, metav1.UpdateOptions{})
	return err
}

// createOrUpdateDedicatedService creates/updates a ClusterIP Service for a dedicated workspace
func (o *Operator) createOrUpdateDedicatedService(ctx context.Context, data *DeploymentData) error {
	serviceName := servicePrefix + data.DeploymentID
	labels := map[string]string{
		labelApp:            appName,
		labelWorkspaceID:    data.DeploymentID,
		labelFunctionsClass: FunctionsClassDedicated,
	}
	selector := map[string]string{
		labelApp:         appName,
		labelWorkspaceID: data.DeploymentID,
	}

	service := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      serviceName,
			Namespace: o.config.KubernetesNamespace,
			Labels:    labels,
		},
		Spec: corev1.ServiceSpec{
			Type:     corev1.ServiceType(o.config.ServiceType),
			Selector: selector,
			Ports: []corev1.ServicePort{
				{
					Name:       "http",
					Port:       int32(o.config.FunctionsServerPort),
					TargetPort: intstr.FromInt(o.config.FunctionsServerPort),
					Protocol:   corev1.ProtocolTCP,
				},
			},
		},
	}

	existing, err := o.clientset.CoreV1().Services(o.config.KubernetesNamespace).Get(ctx, serviceName, metav1.GetOptions{})
	if err != nil {
		if errors.IsNotFound(err) {
			_, err = o.clientset.CoreV1().Services(o.config.KubernetesNamespace).Create(ctx, service, metav1.CreateOptions{})
			return err
		}
		return err
	}

	// If changing from ExternalName to ClusterIP, we need to delete and recreate
	// because Kubernetes doesn't allow changing service type in-place for some transitions
	if existing.Spec.Type == corev1.ServiceTypeExternalName {
		// Delete the old ExternalName service
		err = o.clientset.CoreV1().Services(o.config.KubernetesNamespace).Delete(ctx, serviceName, metav1.DeleteOptions{})
		if err != nil {
			return fmt.Errorf("failed to delete ExternalName service for upgrade: %v", err)
		}
		// Create new ClusterIP service
		_, err = o.clientset.CoreV1().Services(o.config.KubernetesNamespace).Create(ctx, service, metav1.CreateOptions{})
		return err
	}

	// Update existing ClusterIP service
	service.Spec.ClusterIP = existing.Spec.ClusterIP
	service.ResourceVersion = existing.ResourceVersion
	_, err = o.clientset.CoreV1().Services(o.config.KubernetesNamespace).Update(ctx, service, metav1.UpdateOptions{})
	return err
}

// buildAllowedCollectionsFileContent builds the allowed collections file content for mongobetween
// based on workspaces in this deployment. Format: one db.collection per line
func (o *Operator) buildAllowedCollectionsFileContent(workspaceIDs []string) string {
	builder := strings.Builder{}
	for _, wsID := range workspaceIDs {
		builder.WriteString(fmt.Sprintf("persistent_store.%s\n", wsID))
	}
	return builder.String()
}

func (o *Operator) buildDeploymentFromData(data *DeploymentData) *appsv1.Deployment {
	var deploymentName string
	labels := map[string]string{
		labelApp:            appName,
		labelFunctionsClass: data.FunctionsClass,
	}

	if data.FunctionsClass == FunctionsClassFree {
		deploymentName = freeDeploymentName
	} else {
		// Dedicated: one workspace
		deploymentName = data.DeploymentID + deploymentSuffix
		labels[labelWorkspaceID] = data.DeploymentID
	}

	var nodeSelector map[string]string
	if o.config.KubernetesNodeSelector != "" {
		nodeSelector = map[string]string{}
		err := hjson.Unmarshal([]byte(o.config.KubernetesNodeSelector), &nodeSelector)
		if err != nil {
			o.Errorf("failed to parse node selector from string: %s\nIngoring it. Error: %v", o.config.KubernetesNodeSelector, err)
		}
	}
	var tolerations []corev1.Toleration
	if o.config.PodsTolerations != "" {
		err := hjson.Unmarshal([]byte(o.config.PodsTolerations), &tolerations)
		if err != nil {
			o.Errorf("failed to parse tolerations from string: %s\nIngoring it. Error: %v", o.config.PodsTolerations, err)
		}
	}

	var resources corev1.ResourceRequirements
	resourcesConfig := o.config.PodsResources
	if data.FunctionsClass == FunctionsClassPremium && o.config.PodsResourcesPremium != "" {
		resourcesConfig = o.config.PodsResourcesPremium
	}
	if resourcesConfig != "" {
		err := hjson.Unmarshal([]byte(resourcesConfig), &resources)
		if err != nil {
			o.Errorf("failed to parse resources from string: %s\nIgnoring it. Error: %v", resourcesConfig, err)
		}
	}

	// Use HPA min replicas when HPA is enabled, otherwise default to 2
	replicas := o.config.MinReplicas
	volumes := make([]corev1.Volume, 0)
	volumeMounts := make([]corev1.VolumeMount, 0)

	// Mount connections ConfigMaps as parts
	// Files are stored with keys like ${workspaceId}__connections.json.gz
	for i := 0; i < data.ConnectionsConfigMapCount; i++ {
		volName := fmt.Sprintf("connections-%d", i)
		cmName := fmt.Sprintf("%s%s-%d", data.DeploymentID, connectionsCMSuffix, i)

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

		// Mount connections ConfigMaps to /data/connections/part-{n}
		volumeMounts = append(volumeMounts, corev1.VolumeMount{
			Name:      volName,
			MountPath: fmt.Sprintf("/data/connections/part-%d", i),
			ReadOnly:  true,
		})
	}

	// Add volumes for functions ConfigMaps
	// Functions are stored with keys like ${workspaceId}__${functionId}.json.gz
	for i := 0; i < data.FunctionsConfigMapCount; i++ {
		volName := fmt.Sprintf("functions-%d", i)
		cmName := fmt.Sprintf("%s%s-%d", data.DeploymentID, functionsCMSuffix, i)

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

		// Mount functions ConfigMaps to /data/functions/part-{n}
		volumeMounts = append(volumeMounts, corev1.VolumeMount{
			Name:      volName,
			MountPath: fmt.Sprintf("/data/functions/part-%d", i),
			ReadOnly:  true,
		})
	}

	// Build environment variables for functions-server
	envVars := []corev1.EnvVar{
		{
			Name:  "CONFIG_DIR",
			Value: "/data",
		},
		{
			Name:  "ROTOR_MODE",
			Value: "functions",
		},
		{
			Name:  "LOG_FORMAT",
			Value: "json",
		},
		{
			Name:  "PORT",
			Value: fmt.Sprintf("%d", o.config.FunctionsServerPort),
		},
		{
			Name:  "FUNCTIONS_CLASS",
			Value: data.FunctionsClass,
		},
		{
			Name:  "FETCH_FORBID_LOCAL",
			Value: "true",
		},
	}

	// Build containers list
	containers := []corev1.Container{}

	// Add mongobetween sidecar if MongoDB is configured
	if o.config.MongoDBURL != "" {
		// Add MONGODB_URL pointing to mongobetween sidecar
		envVars = append(envVars, corev1.EnvVar{
			Name:  "MONGODB_URL",
			Value: fmt.Sprintf("mongodb://localhost:%d", o.config.MongobetweenPort),
		})

		// Add volume for mongobetween allowed collections config
		mongobetweenConfigVolName := "mongobetween-config"
		mongobetweenConfigCMName := fmt.Sprintf("%s-mongobetween", data.DeploymentID)
		volumes = append(volumes, corev1.Volume{
			Name: mongobetweenConfigVolName,
			VolumeSource: corev1.VolumeSource{
				ConfigMap: &corev1.ConfigMapVolumeSource{
					LocalObjectReference: corev1.LocalObjectReference{
						Name: mongobetweenConfigCMName,
					},
				},
			},
		})

		// mongobetween sidecar container using environment variables
		mongobetweenEnvVars := []corev1.EnvVar{
			{
				Name:  "MONGOBETWEEN_LOGLEVEL",
				Value: "info",
			},
			{
				Name:  "MONGOBETWEEN_ADDRESSES",
				Value: fmt.Sprintf(":%d=%s", o.config.MongobetweenPort, o.config.MongoDBURL),
			},
			{
				Name:  "MONGOBETWEEN_ALLOWED_COLLECTIONS_FILE",
				Value: "/etc/mongobetween/allowed-collections.txt",
			},
		}

		mongobetweenVolumeMounts := []corev1.VolumeMount{
			{
				Name:      mongobetweenConfigVolName,
				MountPath: "/etc/mongobetween",
				ReadOnly:  true,
			},
		}

		containers = append(containers, corev1.Container{
			Name:         "mongobetween",
			Image:        o.config.MongobetweenImage,
			Env:          mongobetweenEnvVars,
			VolumeMounts: mongobetweenVolumeMounts,
			Ports: []corev1.ContainerPort{
				{
					ContainerPort: int32(o.config.MongobetweenPort),
					Protocol:      corev1.ProtocolTCP,
				},
			},
			// Simple TCP liveness check for mongobetween
			LivenessProbe: &corev1.Probe{
				ProbeHandler: corev1.ProbeHandler{
					TCPSocket: &corev1.TCPSocketAction{
						Port: intstr.FromInt(o.config.MongobetweenPort),
					},
				},
				InitialDelaySeconds: 5,
				PeriodSeconds:       30,
			},
		})
	}

	// Add functions-server container
	containers = append(containers, corev1.Container{
		Name:  appName,
		Image: o.config.FunctionsServerImage,
		Ports: []corev1.ContainerPort{
			{
				ContainerPort: int32(o.config.FunctionsServerPort),
				Protocol:      corev1.ProtocolTCP,
			},
		},
		Resources:    resources,
		Env:          envVars,
		VolumeMounts: volumeMounts,
		Lifecycle: &corev1.Lifecycle{
			PreStop: &corev1.LifecycleHandler{
				Exec: &corev1.ExecAction{
					Command: []string{"/bin/sleep", "20"},
				},
			},
		},
		LivenessProbe: &corev1.Probe{
			ProbeHandler: corev1.ProbeHandler{
				HTTPGet: &corev1.HTTPGetAction{
					Path: "/health",
					Port: intstr.FromInt(o.config.FunctionsServerPort),
				},
			},
			InitialDelaySeconds: 10,
			PeriodSeconds:       10,
			TimeoutSeconds:      5,
			FailureThreshold:    5,
		},
		ReadinessProbe: &corev1.Probe{
			ProbeHandler: corev1.ProbeHandler{
				HTTPGet: &corev1.HTTPGetAction{
					Path: "/health",
					Port: intstr.FromInt(o.config.FunctionsServerPort),
				},
			},
			InitialDelaySeconds: 5,
			PeriodSeconds:       5,
			TimeoutSeconds:      3,
		},
	})
	sec30 := int64(30)
	podSpec := corev1.PodSpec{
		TerminationGracePeriodSeconds: &sec30,
		Containers:                    containers,
		Volumes:                       volumes,
		NodeSelector:                  nodeSelector,
		Tolerations:                   tolerations,
	}

	// Add service account if configured
	if o.config.PodsServiceAccount != "" {
		podSpec.ServiceAccountName = o.config.PodsServiceAccount
	}

	return &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      deploymentName,
			Namespace: o.config.KubernetesNamespace,
			Labels:    labels,
			Annotations: map[string]string{
				labelWorkspaceIDs:       strings.Join(data.WorkspaceIDs, ","),
				labelOperatorConfigHash: data.OperatorConfigHash,
				annotationPromScrape:    "false",
			},
		},
		Spec: appsv1.DeploymentSpec{
			Replicas: &replicas,
			Selector: &metav1.LabelSelector{
				MatchLabels: labels,
			},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{
					Labels: labels,
					Annotations: map[string]string{
						labelConfigHash:         data.ConfigHash,
						labelOperatorConfigHash: data.OperatorConfigHash,
						labelWorkspaceIDs:       strings.Join(data.WorkspaceIDs, ","),
					},
				},
				Spec: podSpec,
			},
		},
	}
}

// createOrUpdateHPA creates or updates a HorizontalPodAutoscaler for a deployment
func (o *Operator) createOrUpdateHPA(ctx context.Context, data *DeploymentData) error {
	if !o.config.HPAEnabled {
		return nil
	}

	var deploymentName string
	var hpaName string

	if data.FunctionsClass == FunctionsClassFree {
		deploymentName = freeDeploymentName
		hpaName = freeDeploymentName + hpaSuffix
	} else {
		deploymentName = data.DeploymentID + deploymentSuffix
		hpaName = data.DeploymentID + hpaSuffix
	}

	labels := map[string]string{
		labelApp:            appName,
		labelFunctionsClass: data.FunctionsClass,
	}
	if data.FunctionsClass == FunctionsClassDedicated {
		labels[labelWorkspaceID] = data.DeploymentID
	}

	minReplicas := o.config.MinReplicas
	scaleDownStabilization := o.config.HPAScaleDownStabilizationSeconds
	scaleUpStabilization := o.config.HPAScaleUpStabilizationSeconds

	// Scale down policy: 1 pod per 120 seconds
	scaleDownPodValue := int32(1)
	scaleDownPeriod := int32(120)

	// Scale up policy: 8 pods per 30 seconds
	scaleUpPodValue := int32(2)
	scaleUpPeriod := int32(30)

	selectPolicyMax := autoscalingv2.MaxChangePolicySelect

	hpa := &autoscalingv2.HorizontalPodAutoscaler{
		ObjectMeta: metav1.ObjectMeta{
			Name:      hpaName,
			Namespace: o.config.KubernetesNamespace,
			Labels:    labels,
			Annotations: map[string]string{
				labelWorkspaceIDs: strings.Join(data.WorkspaceIDs, ","),
			},
		},
		Spec: autoscalingv2.HorizontalPodAutoscalerSpec{
			ScaleTargetRef: autoscalingv2.CrossVersionObjectReference{
				APIVersion: "apps/v1",
				Kind:       "Deployment",
				Name:       deploymentName,
			},
			MinReplicas: &minReplicas,
			MaxReplicas: o.config.HPAMaxReplicas,
			Behavior: &autoscalingv2.HorizontalPodAutoscalerBehavior{
				ScaleDown: &autoscalingv2.HPAScalingRules{
					StabilizationWindowSeconds: &scaleDownStabilization,
					Policies: []autoscalingv2.HPAScalingPolicy{
						{
							Type:          autoscalingv2.PodsScalingPolicy,
							Value:         scaleDownPodValue,
							PeriodSeconds: scaleDownPeriod,
						},
					},
				},
				ScaleUp: &autoscalingv2.HPAScalingRules{
					StabilizationWindowSeconds: &scaleUpStabilization,
					SelectPolicy:               &selectPolicyMax,
					Policies: []autoscalingv2.HPAScalingPolicy{
						{
							Type:          autoscalingv2.PodsScalingPolicy,
							Value:         scaleUpPodValue,
							PeriodSeconds: scaleUpPeriod,
						},
					},
				},
			},
			Metrics: []autoscalingv2.MetricSpec{
				{
					Type: autoscalingv2.ResourceMetricSourceType,
					Resource: &autoscalingv2.ResourceMetricSource{
						Name: corev1.ResourceCPU,
						Target: autoscalingv2.MetricTarget{
							Type:               autoscalingv2.UtilizationMetricType,
							AverageUtilization: &o.config.HPATargetCPUUtilization,
						},
					},
				},
			},
		},
	}

	existing, err := o.clientset.AutoscalingV2().HorizontalPodAutoscalers(o.config.KubernetesNamespace).Get(ctx, hpaName, metav1.GetOptions{})
	if err != nil {
		if errors.IsNotFound(err) {
			_, err = o.clientset.AutoscalingV2().HorizontalPodAutoscalers(o.config.KubernetesNamespace).Create(ctx, hpa, metav1.CreateOptions{})
			if err != nil {
				return fmt.Errorf("failed to create HPA %s: %v", hpaName, err)
			}
			logging.Infof("Created HPA %s", hpaName)
			return nil
		}
		return fmt.Errorf("failed to get HPA %s: %v", hpaName, err)
	}

	// Update existing HPA
	hpa.ResourceVersion = existing.ResourceVersion
	_, err = o.clientset.AutoscalingV2().HorizontalPodAutoscalers(o.config.KubernetesNamespace).Update(ctx, hpa, metav1.UpdateOptions{})
	if err != nil {
		return fmt.Errorf("failed to update HPA %s: %v", hpaName, err)
	}
	logging.Infof("Updated HPA %s", hpaName)
	return nil
}

// deleteHPA deletes the HorizontalPodAutoscaler for a deployment
func (o *Operator) deleteHPA(ctx context.Context, deploymentID string, functionsClass string) error {
	var hpaName string
	if functionsClass == FunctionsClassFree {
		hpaName = freeDeploymentName + hpaSuffix
	} else {
		hpaName = deploymentID + hpaSuffix
	}

	err := o.clientset.AutoscalingV2().HorizontalPodAutoscalers(o.config.KubernetesNamespace).Delete(ctx, hpaName, metav1.DeleteOptions{})
	if err != nil && !errors.IsNotFound(err) {
		return fmt.Errorf("failed to delete HPA %s: %v", hpaName, err)
	}
	if err == nil {
		logging.Infof("Deleted HPA %s", hpaName)
	}
	return nil
}
