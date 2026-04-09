package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/hjson/hjson-go/v4"
	"github.com/jitsucom/bulker/jitsubase/appbase"
	"github.com/jitsucom/bulker/jitsubase/logging"
	"github.com/jitsucom/bulker/jitsubase/pg"
	"github.com/jitsucom/bulker/jitsubase/safego"
	"github.com/jitsucom/bulker/jitsubase/utils"
	appsv1 "k8s.io/api/apps/v1"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
	corev1 "k8s.io/api/core/v1"
	policyv1 "k8s.io/api/policy/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/client-go/kubernetes"
)

const (
	labelApp                = "app"
	labelWorkspaceID        = "jitsu.com/workspace-id"
	labelWorkspaceIDs       = "jitsu.com/workspace-ids" // For multi-workspace deployments (annotation, comma-separated)
	labelConfigHash         = "jitsu.com/config-hash"
	labelOperatorConfigHash = "jitsu.com/operator-config-hash"
	labelConfigType         = "jitsu.com/config-type"
	labelFunctionsClass     = "jitsu.com/functions-class"
	labelConfigPartIdx      = "jitsu.com/config-part"
	labelShutdownAt         = "jitsu.com/shutdown-at"
	labelConnectionsMap     = "jitsu.com/connections-map" // JSON: per-workspace connections and emptyConnections
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

	// HPA suffix
	hpaSuffix = "-fs-hpa"
	// PDB suffix
	pdbSuffix = "-fs-pdb"
)

type Operator struct {
	appbase.Service
	config    *Config
	clientset *kubernetes.Clientset

	connectionsRepo appbase.Repository[ConnectionsData]
	functionsRepo   appbase.Repository[FunctionsData]
	workspacesRepo  appbase.Repository[WorkspacesData]

	functionsServerDB *FunctionsServerDB

	fastStoreWorkspaceIDs map[string]struct{}

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

	if ctx.config.DatabaseURL != "" {
		dbpool, err := pg.NewPGPool(ctx.config.DatabaseURL)
		if err != nil {
			return nil, fmt.Errorf("failed to create database connection pool: %v", err)
		}
		op.functionsServerDB = NewFunctionsServerDB(dbpool)
	}

	op.fastStoreWorkspaceIDs = make(map[string]struct{})
	for _, id := range strings.Split(ctx.config.FastStoreWorkspaceIDs, ",") {
		op.fastStoreWorkspaceIDs[strings.TrimSpace(id)] = struct{}{}
	}

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

	// Watch for changes + periodic reconcile for time-based transitions
	safego.RunWithRestart(func() {
		connChanges := o.connectionsRepo.ChangesChannel()
		funcChanges := o.functionsRepo.ChangesChannel()
		wsChanges := o.workspacesRepo.ChangesChannel()

		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()

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
			case <-ticker.C:
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
	if o.functionsServerDB != nil {
		o.functionsServerDB.dbpool.Close()
	}
	return nil
}

func (o *Operator) reconcile() {
	ctx := context.Background()

	sw := utils.NewStopwatch()

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

		isDedicated := slices.Contains(functionsClasses, FunctionsClassPremium) || slices.Contains(functionsClasses, FunctionsClassDedicated)

		wsWorkspaceData := CalculateWorkspaceData(ws, connData.byWorkspace[ws.ID], funcData.byWorkspace[ws.ID])

		freeAdded := false
		if slices.Contains(functionsClasses, FunctionsClassFree) {
			freeWorkspaces = append(freeWorkspaces, wsWorkspaceData)
			freeAdded = true
		}
		if isDedicated {
			wData := *wsWorkspaceData // Copy
			wData.FunctionsClass = utils.Ternary(slices.Contains(functionsClasses, FunctionsClassPremium), FunctionsClassPremium, FunctionsClassDedicated)
			if len(wData.Connections) == 0 || len(wData.Functions) == 0 {
				freeWorkspaces = append(freeWorkspaces, wsWorkspaceData)
				continue
			}
			dedicatedWorkspaces[ws.ID] = &wData

			// Free → Dedicated transition: keep workspace in free deployment until
			// the dedicated deployment has been fully rolled out for 5+ minutes,
			// giving all Rotor instances time to pick up the new deployment.
			// Only applies to freshly created deployments (< 6 min old) — an existing
			// deployment being updated should not fall back to free.
			if !slices.Contains(functionsClasses, FunctionsClassFree) {
				existing := existingDeployments[ws.ID]
				isNewDeployment := existing == nil || time.Since(existing.CreatedAt) < 6*time.Minute
				if isNewDeployment {
					handoffReady := existing != nil && existing.RolledOut &&
						!existing.RolloutCompletedAt.IsZero() && time.Since(existing.RolloutCompletedAt) > 5*time.Minute
					if !handoffReady && !freeAdded {
						freeWorkspaces = append(freeWorkspaces, wsWorkspaceData)
					}
				}
			}
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

	// Add free deployments (sharded by workspaceId)
	if len(freeWorkspaces) > 0 {
		shardedFree := o.buildFreeShardedDeployments(freeWorkspaces)
		for shardID, data := range shardedFree {
			data.OperatorConfigHash = operatorConfigHash
			desiredDeployments[shardID] = data
		}
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
			if existing.ShutdownAt != nil {
				needDeploy = true
			} else if existing.ConfigHash != deploymentData.ConfigHash {
				needDeploy = true
				logging.Infof("Updating deployment %s (hash changed: %s -> %s)",
					deploymentID, existing.ConfigHash, deploymentData.ConfigHash)
			} else if existing.OperatorConfigHash != deploymentData.OperatorConfigHash {
				needDeploy = true
				logging.Infof("Updating deployment %s (operator config changed: %s -> %s)",
					deploymentID, existing.OperatorConfigHash, deploymentData.OperatorConfigHash)
			} else if existing.FunctionsClass != deploymentData.FunctionsClass {
				needDeploy = true
				logging.Infof("Updating deployment %s (functions class changed: %s -> %s)",
					deploymentID, existing.FunctionsClass, deploymentData.FunctionsClass)
			}
			if needDeploy {
				if err := o.updateDeploymentFromData(deploymentData, existing); err != nil {
					logging.Errorf("Failed to update deployment %s: %v", deploymentID, err)
					continue
				}
			}
		}
	}

	// Pass 1: Mark unwanted deployments for shutdown via K8s annotation.
	// Set jitsu.com/shutdown-at on deployments no longer needed whose workspaces
	// have a rolled-out deployment of another class, or no longer exist in the repository.
	for deploymentID, existing := range existingDeployments {
		_, desired := desiredDeployments[deploymentID]
		if desired {
			continue
		}
		if existing.ShutdownAt != nil {
			continue // already marked
		}
		if o.allWorkspacesHandled(existing, existingDeployments, wsData) {
			shutdownAt := time.Now().Add(10 * time.Minute)
			if err := o.setDeploymentShutdownAt(ctx, existing, shutdownAt); err != nil {
				logging.Errorf("Failed to mark deployment %s for shutdown: %v", deploymentID, err)
			} else {
				logging.Infof("Deployment %s marked for shutdown at %v", deploymentID, shutdownAt.Format(time.RFC3339))
			}
		}
	}

	// Pass 2: Delete deployments whose shutdownAt has passed.
	for deploymentID, existing := range existingDeployments {
		if _, desired := desiredDeployments[deploymentID]; desired {
			continue
		}
		if existing.ShutdownAt == nil || time.Now().Before(*existing.ShutdownAt) {
			continue
		}
		logging.Infof("Deleting deployment %s (shutdown time reached)", deploymentID)
		if err := o.deleteDeploymentByID(deploymentID, existing); err != nil {
			logging.Errorf("Failed to delete deployment %s: %v", deploymentID, err)
			continue
		}
		if o.functionsServerDB != nil {
			if err := o.functionsServerDB.DeleteRecordsForDeployment(deploymentID); err != nil {
				logging.Errorf("Failed to delete FunctionsServer records for deployment %s: %v", deploymentID, err)
			}
		}
	}

	// Upsert FunctionsServer records only for fully rolled out deployments
	if o.functionsServerDB != nil {
		o.syncFunctionsServerTable(desiredDeployments, existingDeployments)
	}

	logging.Debugf("[reconcile] total: %dms", sw.ElapsedMs())
}

// setDeploymentShutdownAt annotates the K8s deployment with jitsu.com/shutdown-at.
func (o *Operator) setDeploymentShutdownAt(ctx context.Context, data *DeploymentData, shutdownAt time.Time) error {
	deploymentName := data.DeploymentID + deploymentSuffix

	dep, err := o.clientset.AppsV1().Deployments(o.config.KubernetesNamespace).Get(ctx, deploymentName, metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("failed to get deployment %s: %v", deploymentName, err)
	}

	if dep.Annotations == nil {
		dep.Annotations = make(map[string]string)
	}
	dep.Annotations[labelShutdownAt] = shutdownAt.Format(time.RFC3339)

	_, err = o.clientset.AppsV1().Deployments(o.config.KubernetesNamespace).Update(ctx, dep, metav1.UpdateOptions{})
	if err != nil {
		return fmt.Errorf("failed to update deployment %s: %v", deploymentName, err)
	}
	return nil
}

// allWorkspacesHandled returns true if every workspace in the deployment either:
// - has a rolled-out deployment of another class in existingDeployments, or
// - is in emptyDedicatedWorkspaces (no functions or connections — no deployment needed), or
// - no longer exists in the repository at all.
func (o *Operator) allWorkspacesHandled(existing *DeploymentData, existingDeployments map[string]*DeploymentData, wsData *WorkspacesData) bool {
	for _, wsID := range existing.WorkspaceIDs {
		// Check if workspace still exists in the repository
		if _, wsExists := wsData.byID[wsID]; !wsExists {
			// Workspace gone from repository — handled
			continue
		}

		// Check if workspace has an alternative deployment that's rolled out
		hasAlternative := false
		for depID, ed := range existingDeployments {
			if depID == existing.DeploymentID {
				continue
			}
			if slices.Contains(ed.WorkspaceIDs, wsID) && ed.RolledOut {
				hasAlternative = true
				break
			}
		}
		if !hasAlternative {
			return false
		}
	}
	return true
}

// syncFunctionsServerTable upserts FunctionsServer records for rolled-out K8s deployments
// and for empty dedicated workspaces (0 functions or 0 connections) that have no K8s deployment.
// Uses connection data from deployment annotations (rolled-out state) and existingDeployments for timestamps.
// Only syncs deployments that are still desired (skips old deployments pending shutdown).
func (o *Operator) syncFunctionsServerTable(desiredDeployments map[string]*DeploymentData, existingDeployments map[string]*DeploymentData) {
	// Sync records from rolled-out K8s deployments using connections map from annotation
	for deploymentID, existing := range existingDeployments {
		if _, desired := desiredDeployments[deploymentID]; !desired {
			continue
		}
		if !existing.RolledOut || existing.ConnectionsMap == nil {
			continue
		}
		// Skip if config hasn't changed since last sync
		if !o.functionsServerDB.IsDeploymentChanged(deploymentID, existing.ConfigHash) {
			continue
		}
		records := BuildRecordsFromConnectionsMap(existing.ConnectionsMap, deploymentID, existing.FunctionsClass)
		if err := o.functionsServerDB.ReplaceRecordsForDeployment(deploymentID, records, existing.CreatedAt, existing.RolloutCompletedAt); err != nil {
			logging.Errorf("Failed to replace FunctionsServer records for deployment %s (%d records): %v", deploymentID, len(records), err)
		} else {
			o.functionsServerDB.MarkDeploymentSynced(deploymentID, existing.ConfigHash)
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
		deploymentID := cm.Labels[labelWorkspaceID]
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

		deploymentID = deployment.Labels[labelWorkspaceID]
		if deploymentID == "" {
			logging.Warnf("Deployment %s has no workspace ID label, skipping", deployment.Name)
			continue
		}
		if functionsClass == FunctionsClassFree {
			if wsIDs := deployment.Annotations[labelWorkspaceIDs]; wsIDs != "" {
				workspaceIDs = strings.Split(wsIDs, ",")
			}
		} else {
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

		// Parse shutdown annotation
		var shutdownAt *time.Time
		if saStr := deployment.Annotations[labelShutdownAt]; saStr != "" {
			if t, err := time.Parse(time.RFC3339, saStr); err == nil {
				shutdownAt = &t
			}
		}

		// Parse connections map annotation
		connectionsMap := ParseConnectionsMapAnnotation(deployment.Annotations[labelConnectionsMap])

		// Compute rollout status by checking the Progressing condition.
		// "NewReplicaSetAvailable" means the latest revision's ReplicaSet has minimum
		// availability — this is stable during HPA scaling (which only adds replicas
		// to the same ReplicaSet, not a new one).
		var isRolledOut bool
		var rolloutCompletedAt time.Time
		if deployment.Status.ObservedGeneration >= deployment.Generation {
			for _, cond := range deployment.Status.Conditions {
				if cond.Type == appsv1.DeploymentProgressing &&
					cond.Status == corev1.ConditionTrue &&
					cond.Reason == "NewReplicaSetAvailable" {
					isRolledOut = true
					rolloutCompletedAt = cond.LastUpdateTime.Time
					break
				}
			}
		}

		result[deploymentID] = &DeploymentData{
			DeploymentID:              deploymentID,
			FunctionsClass:            functionsClass,
			WorkspaceIDs:              workspaceIDs,
			ConfigHash:                configHash,
			OperatorConfigHash:        operatorConfigHash,
			ConnectionsConfigMapCount: connsCMCount,
			FunctionsConfigMapCount:   funcsCMCount,
			Replicas:                  deployment.Spec.Replicas,
			ShutdownAt:                shutdownAt,
			RolledOut:                 isRolledOut,
			RolloutCompletedAt:        rolloutCompletedAt,
			CreatedAt:                 deployment.CreationTimestamp.Time,
			ConnectionsMap:            connectionsMap,
		}
	}

	return result, nil
}

// buildFreeShardedDeployments distributes free workspaces across shards
// and returns a map of shardID -> DeploymentData
func (o *Operator) buildFreeShardedDeployments(workspaces []*WorkspaceData) map[string]*DeploymentData {
	numShards := o.config.FreeShards
	if numShards < 1 {
		numShards = 1
	}

	// Group workspaces by shard
	shardWorkspaces := make(map[int][]*WorkspaceData)
	for _, ws := range workspaces {
		shard := workspaceShardIndex(ws.WorkspaceID, numShards)
		shardWorkspaces[shard] = append(shardWorkspaces[shard], ws)
	}

	result := make(map[string]*DeploymentData)
	for shardIdx, wsSlice := range shardWorkspaces {
		var allConnections []*EnrichedConnectionConfig
		var allFunctions []*FunctionConfig
		workspaceIDs := make([]string, 0, len(wsSlice))

		for _, ws := range wsSlice {
			workspaceIDs = append(workspaceIDs, ws.WorkspaceID)
			allConnections = append(allConnections, ws.Connections...)
			allFunctions = append(allFunctions, ws.Functions...)
		}

		sort.Strings(workspaceIDs)
		configHash := CalculateConfigHash(allConnections, allFunctions, workspaceIDs)

		shardID := freeShardDeploymentID(shardIdx, numShards)
		result[shardID] = &DeploymentData{
			DeploymentID:   shardID,
			FunctionsClass: FunctionsClassFree,
			WorkspaceIDs:   workspaceIDs,
			Connections:    allConnections,
			Functions:      allFunctions,
			ConfigHash:     configHash,
		}
	}

	return result
}

// freeShardDeploymentID returns the deployment ID for a free shard (e.g., "free-0", "free-1")
func freeShardDeploymentID(shardIndex, numShards int) string {
	return fmt.Sprintf("free-%d-%d", shardIndex, numShards)
}

// workspaceShardIndex returns the shard index for a workspace ID
func workspaceShardIndex(workspaceID string, numShards int) int {
	if numShards <= 1 {
		return 0
	}
	h := sha256.Sum256([]byte(workspaceID))
	// Use first 4 bytes as uint32
	val := uint32(h[0])<<24 | uint32(h[1])<<16 | uint32(h[2])<<8 | uint32(h[3])
	return int(val % uint32(numShards))
}

// getFunctionsClasses returns the functions class for a workspace based on feature flags.
// Format: ${FunctionsClassFeatureFlag}=<value> where value is dedicated, free, or legacy.
// Returns empty string if no matching feature flag is found (uses default).
func (o *Operator) getFunctionsClasses(ws *WorkspaceConfig) []string {
	prefix := "functionsClasses="
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
			if o.config.HPAEnabled {
				// Get current replicas from live deployment to preserve HPA-managed value
				currentDeployment, getErr := o.clientset.AppsV1().Deployments(o.config.KubernetesNamespace).Get(ctx, deployment.Name, metav1.GetOptions{})
				if getErr == nil && currentDeployment.Spec.Replicas != nil {
					deployment.Spec.Replicas = currentDeployment.Spec.Replicas
				}
			}
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

	// Create PDB
	if err := o.createOrUpdatePDB(ctx, data); err != nil {
		return fmt.Errorf("failed to create PDB: %v", err)
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
	if o.config.HPAEnabled && existing != nil && existing.Replicas != nil {
		// Preserve replicas managed by the autoscaler
		deployment.Spec.Replicas = existing.Replicas
	}
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

	// Update PDB
	if err := o.createOrUpdatePDB(ctx, data); err != nil {
		return fmt.Errorf("failed to update PDB: %v", err)
	}

	return nil
}

func (o *Operator) deleteDeploymentByID(deploymentID string, existing *DeploymentData) error {
	ctx := context.Background()
	deploymentName := deploymentID + deploymentSuffix

	// Delete Service
	serviceName := servicePrefix + deploymentID
	err := o.clientset.CoreV1().Services(o.config.KubernetesNamespace).Delete(ctx, serviceName, metav1.DeleteOptions{})
	if err != nil && !errors.IsNotFound(err) {
		return fmt.Errorf("failed to delete service: %v", err)
	}

	// Delete Deployment
	err = o.clientset.AppsV1().Deployments(o.config.KubernetesNamespace).Delete(ctx, deploymentName, metav1.DeleteOptions{})
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
	if err := o.deleteHPA(ctx, deploymentID); err != nil {
		logging.Warnf("Failed to delete HPA: %v", err)
	}

	// Delete PDB
	if err := o.deletePDB(ctx, deploymentID); err != nil {
		logging.Warnf("Failed to delete PDB: %v", err)
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
					labelWorkspaceID:    data.DeploymentID,
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
					labelWorkspaceID:    data.DeploymentID,
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
		return o.createOrUpdateFreeService(ctx, data)
	}
	return o.createOrUpdateDedicatedService(ctx, data)
}

// createOrUpdateFreeService creates/updates the Service for a free shard deployment
func (o *Operator) createOrUpdateFreeService(ctx context.Context, data *DeploymentData) error {
	serviceName := servicePrefix + data.DeploymentID
	labels := map[string]string{
		labelApp:            appName,
		labelFunctionsClass: FunctionsClassFree,
	}
	selector := map[string]string{
		labelApp:         appName,
		labelWorkspaceID: data.DeploymentID,
	}
	preferClose := "PreferClose"

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
			Type:                corev1.ServiceType(o.config.ServiceType),
			Selector:            selector,
			TrafficDistribution: &preferClose,
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
	preferClose := "PreferClose"

	service := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      serviceName,
			Namespace: o.config.KubernetesNamespace,
			Labels:    labels,
		},
		Spec: corev1.ServiceSpec{
			Type:                corev1.ServiceType(o.config.ServiceType),
			Selector:            selector,
			TrafficDistribution: &preferClose,
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

	// Update existing service
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
	labels := map[string]string{
		labelApp:            appName,
		labelFunctionsClass: data.FunctionsClass,
	}

	deploymentName := data.DeploymentID + deploymentSuffix
	labels[labelWorkspaceID] = data.DeploymentID

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
	var topologySpreadConstraints []corev1.TopologySpreadConstraint
	if o.config.PodsTopologySpreadConstraints != "" {
		tscConfig := strings.ReplaceAll(o.config.PodsTopologySpreadConstraints, "$deploymentId", data.DeploymentID)
		err := hjson.Unmarshal([]byte(tscConfig), &topologySpreadConstraints)
		if err != nil {
			o.Errorf("failed to parse topology spread constraints from string: %s\nIgnoring it. Error: %v", tscConfig, err)
		}
	}

	var resources corev1.ResourceRequirements
	resourcesConfig := o.config.PodsResources
	if data.FunctionsClass == FunctionsClassPremium && o.config.PodsResourcesPremium != "" {
		resourcesConfig = o.config.PodsResourcesPremium
	} else if data.FunctionsClass == FunctionsClassFree && o.config.PodsResourcesFree != "" {
		resourcesConfig = o.config.PodsResourcesFree
	}
	if resourcesConfig != "" {
		err := hjson.Unmarshal([]byte(resourcesConfig), &resources)
		if err != nil {
			o.Errorf("failed to parse resources from string: %s\nIgnoring it. Error: %v", resourcesConfig, err)
		}
	}

	replicas := o.config.MinReplicas
	if data.FunctionsClass == FunctionsClassPremium {
		replicas = o.config.MinReplicasPremium
	} else if data.FunctionsClass == FunctionsClassFree {
		replicas = o.config.MinReplicasFree
	}
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

	_, fastStoreEnabled := o.fastStoreWorkspaceIDs[data.DeploymentID]

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
			Name:  "DEPLOYMENT_ID",
			Value: data.DeploymentID,
		},
		{
			Name:  "FUNCTIONS_CLASS",
			Value: data.FunctionsClass,
		},
		{
			Name:  "FETCH_FORBID_LOCAL",
			Value: "true",
		},
		{
			Name:  "FAST_STORE",
			Value: utils.Ternary(fastStoreEnabled, "true", "false"),
		},
		{
			Name:  "MONGODB_TIMEOUT_MS",
			Value: fmt.Sprint(o.config.MongoDBTimeoutMs),
		},
		{
			Name:  "MONGODB_MAX_POOL_SIZE",
			Value: fmt.Sprint(utils.Ternary(data.FunctionsClass == FunctionsClassPremium, o.config.MongoDBMaxPoolSizePremium, o.config.MongoDBMaxPoolSize)),
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
			{
				Name:  "MONGOBETWEEN_MAX_POOL_SIZE",
				Value: fmt.Sprint(utils.Ternary(data.FunctionsClass == FunctionsClassPremium, o.config.MongoDBMaxPoolSizePremium, o.config.MongoDBMaxPoolSize)),
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
			Lifecycle: &corev1.Lifecycle{
				PreStop: &corev1.LifecycleHandler{
					Exec: &corev1.ExecAction{
						Command: []string{"/bin/sleep", "25"},
					},
				},
			},
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
			{
				ContainerPort: int32(9091),
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
	sec60 := int64(60)
	podSpec := corev1.PodSpec{
		TerminationGracePeriodSeconds: &sec60,
		Containers:                    containers,
		Volumes:                       volumes,
		NodeSelector:                  nodeSelector,
		Tolerations:                   tolerations,
		TopologySpreadConstraints:     topologySpreadConstraints,
	}

	// Add service account if configured
	if o.config.PodsServiceAccount != "" {
		podSpec.ServiceAccountName = o.config.PodsServiceAccount
	}

	maxUnavailable := intstr.FromInt(0)
	maxSurge := intstr.FromInt32(o.config.MinReplicas)

	// Extra labels for deployment and pod template metadata (not selector, which is immutable)
	allLabels := make(map[string]string, len(labels)+1)
	for k, v := range labels {
		allLabels[k] = v
	}
	allLabels["jitsu.com/deployment-id"] = data.DeploymentID

	return &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      deploymentName,
			Namespace: o.config.KubernetesNamespace,
			Labels:    allLabels,
			Annotations: map[string]string{
				labelWorkspaceIDs:       strings.Join(data.WorkspaceIDs, ","),
				labelOperatorConfigHash: data.OperatorConfigHash,
				labelShutdownAt:         "",
				labelConnectionsMap:     BuildConnectionsMapAnnotation(data),
			},
		},
		Spec: appsv1.DeploymentSpec{
			Replicas: &replicas,
			Strategy: appsv1.DeploymentStrategy{
				Type: appsv1.RollingUpdateDeploymentStrategyType,
				RollingUpdate: &appsv1.RollingUpdateDeployment{
					MaxUnavailable: &maxUnavailable,
					MaxSurge:       &maxSurge,
				},
			},
			Selector: &metav1.LabelSelector{
				MatchLabels: labels,
			},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{
					Labels: allLabels,
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

	deploymentName := data.DeploymentID + deploymentSuffix
	hpaName := data.DeploymentID + hpaSuffix

	labels := map[string]string{
		labelApp:            appName,
		labelFunctionsClass: data.FunctionsClass,
	}
	if data.FunctionsClass == FunctionsClassDedicated {
		labels[labelWorkspaceID] = data.DeploymentID
	}

	var minReplicas int32
	switch data.FunctionsClass {
	case FunctionsClassPremium:
		minReplicas = o.config.MinReplicasPremium
	case FunctionsClassFree:
		minReplicas = o.config.MinReplicasFree
	default:
		minReplicas = o.config.MinReplicas
	}
	scaleDownStabilization := o.config.HPAScaleDownStabilizationSeconds
	scaleUpStabilization := o.config.HPAScaleUpStabilizationSeconds

	scaleDownPodValue := int32(1)
	scaleDownPeriod := int32(60)

	scaleUpPodValue := minReplicas * 2
	scaleUpPeriod := int32(15)

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
func (o *Operator) deleteHPA(ctx context.Context, deploymentID string) error {
	hpaName := deploymentID + hpaSuffix

	err := o.clientset.AutoscalingV2().HorizontalPodAutoscalers(o.config.KubernetesNamespace).Delete(ctx, hpaName, metav1.DeleteOptions{})
	if err != nil && !errors.IsNotFound(err) {
		return fmt.Errorf("failed to delete HPA %s: %v", hpaName, err)
	}
	if err == nil {
		logging.Infof("Deleted HPA %s", hpaName)
	}
	return nil
}

// createOrUpdatePDB creates or updates a PodDisruptionBudget for a deployment
func (o *Operator) createOrUpdatePDB(ctx context.Context, data *DeploymentData) error {
	var pdbName string

	labels := map[string]string{
		labelApp:            appName,
		labelFunctionsClass: data.FunctionsClass,
	}

	pdbName = data.DeploymentID + pdbSuffix
	if data.FunctionsClass != FunctionsClassFree {
		labels[labelWorkspaceID] = data.DeploymentID
	}

	matchLabels := map[string]string{
		"jitsu.com/deployment-id": data.DeploymentID,
	}

	maxUnavailable := intstr.FromInt(1)

	pdb := &policyv1.PodDisruptionBudget{
		ObjectMeta: metav1.ObjectMeta{
			Name:      pdbName,
			Namespace: o.config.KubernetesNamespace,
			Labels:    labels,
		},
		Spec: policyv1.PodDisruptionBudgetSpec{
			MaxUnavailable: &maxUnavailable,
			Selector: &metav1.LabelSelector{
				MatchLabels: matchLabels,
			},
		},
	}

	existing, err := o.clientset.PolicyV1().PodDisruptionBudgets(o.config.KubernetesNamespace).Get(ctx, pdbName, metav1.GetOptions{})
	if err != nil {
		if errors.IsNotFound(err) {
			_, err = o.clientset.PolicyV1().PodDisruptionBudgets(o.config.KubernetesNamespace).Create(ctx, pdb, metav1.CreateOptions{})
			if err != nil {
				return fmt.Errorf("failed to create PDB %s: %v", pdbName, err)
			}
			logging.Infof("Created PDB %s", pdbName)
			return nil
		}
		return fmt.Errorf("failed to get PDB %s: %v", pdbName, err)
	}

	// Update existing PDB
	pdb.ResourceVersion = existing.ResourceVersion
	_, err = o.clientset.PolicyV1().PodDisruptionBudgets(o.config.KubernetesNamespace).Update(ctx, pdb, metav1.UpdateOptions{})
	if err != nil {
		return fmt.Errorf("failed to update PDB %s: %v", pdbName, err)
	}
	logging.Infof("Updated PDB %s", pdbName)
	return nil
}

// deletePDB deletes the PodDisruptionBudget for a deployment
func (o *Operator) deletePDB(ctx context.Context, deploymentID string) error {
	pdbName := deploymentID + pdbSuffix

	err := o.clientset.PolicyV1().PodDisruptionBudgets(o.config.KubernetesNamespace).Delete(ctx, pdbName, metav1.DeleteOptions{})
	if err != nil && !errors.IsNotFound(err) {
		return fmt.Errorf("failed to delete PDB %s: %v", pdbName, err)
	}
	if err == nil {
		logging.Infof("Deleted PDB %s", pdbName)
	}
	return nil
}
