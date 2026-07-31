package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jitsucom/bulker/jitsubase/appbase"
	"github.com/jitsucom/bulker/jitsubase/uuid"
)

// Compile regex once at package level for performance
var timestampRegex = regexp.MustCompile(`(\d{4}_\d{2}_\d{2}T\d{2}_\d{2}_\d{2})`)

// ReprocessingJobStatus represents the status of a reprocessing job
type ReprocessingJobStatus string

const (
	JobStatusPending   ReprocessingJobStatus = "pending"
	JobStatusRunning   ReprocessingJobStatus = "running"
	JobStatusCompleted ReprocessingJobStatus = "completed"
	JobStatusFailed    ReprocessingJobStatus = "failed"
	JobStatusCancelled ReprocessingJobStatus = "cancelled"
)

// ReprocessingJobConfig contains configuration for starting a reprocessing job
type ReprocessingJobConfig struct {
	S3Path        string    `json:"s3_path,omitempty"`    // S3 path (s3://bucket/prefix)
	LocalPath     string    `json:"local_path,omitempty"` // Local filesystem path
	StreamIds     []string  `json:"stream_ids,omitempty"`
	ConnectionIds []string  `json:"connection_ids,omitempty"`
	Files         []string  `json:"files,omitempty"` // Optional list of specific files to process
	DryRun        bool      `json:"dry_run"`
	StartFile     string    `json:"start_file,omitempty"`
	StartLine     int64     `json:"start_line,omitempty"`
	BatchSize     int       `json:"batch_size,omitempty"`
	RetryAttempts int       `json:"retry_attempts,omitempty"` // Number of retry attempts for file processing (default: 3)
	DateFrom      time.Time `json:"date_from,omitempty"`      // Filter messages created after this date
	DateTo        time.Time `json:"date_to,omitempty"`        // Filter messages created before this date
	Limit         int64     `json:"limit,omitempty"`          // Maximum number of events to process
	// ParallelWorkers caps how many worker pods run at once (K8s Job
	// parallelism). 0 = fall back to the K8S_MAX_PARALLEL_WORKERS env cap.
	ParallelWorkers int `json:"parallel_workers,omitempty"`
	// StreamConnections maps a stream id (or slug) to the connection ids to
	// use for its events. Semantics depend on StreamConnectionsFilter:
	// override (default) — listed connections replace the repository-mapped
	// ones; filter — repository-mapped connections are kept only if listed.
	// Streams absent from the map keep the default behavior.
	StreamConnections map[string][]string `json:"stream_connections,omitempty"`
	// StreamConnectionsFilter switches StreamConnections from override mode
	// to filter mode (exclude mapped connections not mentioned).
	StreamConnectionsFilter bool `json:"stream_connections_filter,omitempty"`
}

// ReprocessingJob represents a failover reprocessing job
type ReprocessingJob struct {
	ID               string                `json:"id"`
	Config           ReprocessingJobConfig `json:"config"`
	Status           ReprocessingJobStatus `json:"status"`
	CreatedAt        time.Time             `json:"created_at"`
	StartedAt        *time.Time            `json:"started_at,omitempty"`
	CompletedAt      *time.Time            `json:"completed_at,omitempty"`
	CurrentFile      string                `json:"current_file,omitempty"`
	CurrentLine      int64                 `json:"current_line"`
	CurrentTimestamp string                `json:"current_timestamp,omitempty"` // Based on IngestMessage.MessageCreated
	TotalFiles       int                   `json:"total_files"`
	ProcessedFiles   int                   `json:"processed_files"`
	TotalLines       int64                 `json:"total_lines"`
	SuccessCount     int64                 `json:"success_count"`
	ErrorCount       int64                 `json:"error_count"`
	SkippedCount     int64                 `json:"skipped_count"`
	ProcessedBytes   int64                 `json:"processed_bytes"`
	LastError        string                `json:"last_error,omitempty"`
	K8sJobName       string                `json:"k8s_job_name,omitempty"`
	TotalWorkers     int                   `json:"total_workers"`
}

// ReprocessingJobManager manages failover reprocessing jobs
type ReprocessingJobManager struct {
	appbase.Service
	s3Client  *s3.Client
	config    *Config
	dbpool    *pgxpool.Pool
	k8sClient *K8sJobClient
}

// NewReprocessingJobManager creates a new reprocessing job manager
func NewReprocessingJobManager(config *Config, dbpool *pgxpool.Pool, k8sClient *K8sJobClient) (*ReprocessingJobManager, error) {
	base := appbase.NewServiceBase("reprocessing-job-manager")

	// Database and K8s client are required
	if dbpool == nil {
		return nil, fmt.Errorf("database connection is required for reprocessing")
	}
	if k8sClient == nil {
		return nil, fmt.Errorf("kubernetes client is required for reprocessing")
	}

	// Initialize AWS config and S3 client
	awsConfig, err := awsconfig.LoadDefaultConfig(context.Background())
	if err != nil {
		return nil, fmt.Errorf("failed to load AWS config: %w", err)
	}

	s3Client := s3.NewFromConfig(awsConfig)

	return &ReprocessingJobManager{
		Service:   base,
		s3Client:  s3Client,
		config:    config,
		dbpool:    dbpool,
		k8sClient: k8sClient,
	}, nil
}

// StartJob starts a new reprocessing job
func (m *ReprocessingJobManager) StartJob(config ReprocessingJobConfig) (*ReprocessingJob, error) {
	m.Infof("[StartJob] Starting new reprocessing job")

	// Validate that either S3 or local path is provided
	if config.S3Path == "" && config.LocalPath == "" {
		m.Errorf("[StartJob] Validation failed: no path provided")
		return nil, fmt.Errorf("either s3_path or local_path must be provided")
	}
	if config.S3Path != "" && config.LocalPath != "" {
		m.Errorf("[StartJob] Validation failed: both paths provided")
		return nil, fmt.Errorf("only one of s3_path or local_path can be provided")
	}

	// Set defaults
	if config.BatchSize <= 0 {
		config.BatchSize = 1000
	}
	m.Infof("[StartJob] Config validated, batch_size=%d", config.BatchSize)

	// Create Kubernetes Job for reprocessing
	ctx := context.Background()

	// List and prepare files with sizes
	m.Infof("[StartJob] Preparing file list from %s%s", config.S3Path, config.LocalPath)
	fileItems, err := m.prepareFileList(ctx, config)
	if err != nil {
		m.Errorf("[StartJob] Failed to prepare file list: %v", err)
		return nil, fmt.Errorf("failed to prepare file list: %w", err)
	}

	if len(fileItems) == 0 {
		m.Errorf("[StartJob] No files found to process")
		return nil, fmt.Errorf("no files found to process")
	}
	m.Infof("[StartJob] Found %d files to process", len(fileItems))

	workerCount := len(fileItems)
	if workerCount > 100 {
		workerCount = 100
	}
	if workerCount < 1 {
		workerCount = 1
	}
	m.Infof("[StartJob] Determined worker count: %d", workerCount)

	// Create job record
	job := &ReprocessingJob{
		ID:           uuid.New(),
		Config:       config,
		Status:       JobStatusPending,
		CreatedAt:    time.Now(),
		TotalFiles:   len(fileItems),
		TotalWorkers: workerCount,
	}
	m.Infof("[StartJob] Created job record with ID %s", job.ID)

	// Insert job into database
	m.Infof("[StartJob] Inserting job %s into database", job.ID)
	err = InsertReprocessingJob(m.dbpool, job)
	if err != nil {
		m.Errorf("[StartJob] Failed to insert job %s into database: %v", job.ID, err)
		return nil, fmt.Errorf("failed to insert job into database: %w", err)
	}

	// Distribute files across workers
	filesPerWorker := make([]int, workerCount)
	for i := range fileItems {
		workerIndex := i % workerCount
		filesPerWorker[workerIndex]++
	}
	m.Infof("[StartJob] Distributed %d files across %d workers", len(fileItems), workerCount)

	// Initialize worker records
	m.Infof("[StartJob] Initializing %d worker records for job %s", workerCount, job.ID)
	err = InitializeWorkers(m.dbpool, job.ID, workerCount, filesPerWorker)
	if err != nil {
		m.Errorf("[StartJob] Failed to initialize workers for job %s: %v", job.ID, err)
		return nil, fmt.Errorf("failed to initialize workers: %w", err)
	}

	// Create K8s Indexed Job
	m.Infof("[StartJob] Creating K8s job for job %s", job.ID)
	k8sJobName, err := m.k8sClient.CreateReprocessingJob(ctx, job.ID, fileItems, config, workerCount)
	if err != nil {
		m.Errorf("[StartJob] Failed to create K8s job for job %s: %v", job.ID, err)
		_ = UpdateReprocessingJobStatus(m.dbpool, job.ID, JobStatusFailed, nil, nil, err.Error())
		return nil, fmt.Errorf("failed to create k8s job: %w", err)
	}
	m.Infof("[StartJob] Created K8s job %s for job %s", k8sJobName, job.ID)

	job.K8sJobName = k8sJobName
	job.Status = JobStatusRunning
	now := time.Now()
	job.StartedAt = &now

	// Update job with K8s job name and status
	m.Infof("[StartJob] Updating job %s with K8s job name %s", job.ID, k8sJobName)
	err = UpdateReprocessingJobK8sName(m.dbpool, job.ID, k8sJobName)
	if err != nil {
		m.Warnf("[StartJob] Failed to update k8s job name for job %s: %v", job.ID, err)
	}

	m.Infof("[StartJob] Updating job %s status to running", job.ID)
	err = UpdateReprocessingJobStatus(m.dbpool, job.ID, JobStatusRunning, &now, nil, "")
	if err != nil {
		m.Warnf("[StartJob] Failed to update job %s status: %v", job.ID, err)
	}

	m.Infof("[StartJob] Successfully created K8s reprocessing job %s with %d workers processing %d files", job.ID, workerCount, len(fileItems))

	return job, nil
}

// prepareFileList lists files and gets their sizes
func (m *ReprocessingJobManager) prepareFileList(ctx context.Context, config ReprocessingJobConfig) ([]FileItem, error) {
	var fileItems []FileItem
	var err error

	// List files based on source type (with sizes)
	if config.S3Path != "" {
		fileItems, err = m.listS3Files(ctx, config.S3Path)
		if err != nil {
			return nil, fmt.Errorf("failed to list S3 files: %w", err)
		}
	} else if config.LocalPath != "" {
		fileItems, err = m.listLocalFiles(config.LocalPath)
		if err != nil {
			return nil, fmt.Errorf("failed to list local files: %w", err)
		}
	}

	// Filter files by date range if specified
	if !config.DateFrom.IsZero() || !config.DateTo.IsZero() {
		fileItems, err = m.filterFilesByDateRange(ctx, fileItems, config.DateFrom, config.DateTo)
		if err != nil {
			return nil, fmt.Errorf("failed to filter files by date range: %w", err)
		}
	}

	// Filter files by specific file list if provided
	if len(config.Files) > 0 {
		fileItems = m.filterFilesByList(fileItems, config.Files)
	}

	return fileItems, nil
}

// GetJob returns a job by ID with enriched K8s status
func (m *ReprocessingJobManager) GetJob(id string) (*ReprocessingJob, error) {
	m.Infof("[GetJob] Starting for job %s", id)

	job, err := GetReprocessingJob(m.dbpool, id)
	if err != nil {
		m.Errorf("[GetJob] Failed to get job %s from database: %v", id, err)
		return nil, err
	}
	m.Infof("[GetJob] Retrieved job %s from database: status=%s, k8s_job_name=%s", id, job.Status, job.K8sJobName)

	// Enrich with K8s job status if available
	if job.Status == JobStatusRunning && job.K8sJobName != "" && m.k8sClient != nil {
		m.Infof("[GetJob] Job %s is running, enriching with K8s status", id)
		if err := m.enrichJobWithK8sStatus(job); err != nil {
			// Log warning but don't fail the request
			m.Warnf("[GetJob] Failed to get K8s status for job %s: %v", id, err)
		} else {
			m.Infof("[GetJob] Successfully enriched job %s with K8s status, new status=%s", id, job.Status)
		}
	} else {
		m.Infof("[GetJob] Skipping K8s enrichment for job %s (status=%s, has_k8s_name=%v, has_k8s_client=%v)",
			id, job.Status, job.K8sJobName != "", m.k8sClient != nil)
	}

	m.Infof("[GetJob] Completed for job %s", id)
	return job, nil
}

// enrichJobWithK8sStatus adds Kubernetes job status information to the job
func (m *ReprocessingJobManager) enrichJobWithK8sStatus(job *ReprocessingJob) error {
	m.Infof("[enrichJobWithK8sStatus] Starting for job %s (k8s_job=%s)", job.ID, job.K8sJobName)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	err := m.enrichJobWithK8sStatusWithContext(ctx, job)
	if err != nil {
		m.Warnf("[enrichJobWithK8sStatus] Failed for job %s: %v", job.ID, err)
	} else {
		m.Infof("[enrichJobWithK8sStatus] Completed for job %s", job.ID)
	}
	return err
}

// enrichJobWithK8sStatusWithContext adds Kubernetes job status information to the job with a custom context
func (m *ReprocessingJobManager) enrichJobWithK8sStatusWithContext(ctx context.Context, job *ReprocessingJob) error {
	m.Infof("[enrichJobWithK8sStatusWithContext] Calling K8s API for job %s", job.K8sJobName)

	k8sStatus, err := m.k8sClient.GetJobStatus(ctx, job.K8sJobName)
	if err != nil {
		m.Warnf("[enrichJobWithK8sStatusWithContext] K8s API call failed for job %s: %v", job.K8sJobName, err)
		// If K8s Job not found, check worker statuses to determine completion
		if strings.Contains(err.Error(), "job not found") {
			m.Infof("[enrichJobWithK8sStatusWithContext] K8s Job %s not found (likely cleaned up), checking worker statuses", job.K8sJobName)
			return m.checkCompletionFromWorkers(job)
		}
		return err
	}

	m.Infof("[enrichJobWithK8sStatusWithContext] K8s API returned for job %s: Active=%d, Succeeded=%d, Failed=%d, CompletionTime=%v",
		job.K8sJobName, k8sStatus.Active, k8sStatus.Succeeded, k8sStatus.Failed, k8sStatus.CompletionTime != nil)

	// K8s Job has CompletionTime when all pods are done (succeeded or failed)
	k8sJobCompleted := k8sStatus.CompletionTime != nil || (k8sStatus.Failed == int32(job.TotalWorkers) && k8sStatus.Active == 0)

	if !k8sJobCompleted {
		m.Infof("[enrichJobWithK8sStatusWithContext] K8s Job %s not yet completed, skipping status update", job.K8sJobName)
		return nil
	}
	m.Infof("[enrichJobWithK8sStatusWithContext] K8s Job %s is completed, updating status", job.K8sJobName)
	// Update job status based on K8s job status if our status is stale
	// Only update if job is in running state and K8s reports completion
	hasFailures := k8sStatus.Failed > 0 && k8sStatus.Active == 0
	allSucceeded := k8sStatus.Succeeded == int32(job.TotalWorkers) && k8sStatus.Active == 0

	if hasFailures {
		// Job has failed pods and no active pods - mark as failed
		m.Infof("[enrichJobWithK8sStatusWithContext] Marking job %s as failed (failed=%d, active=%d)", job.ID, k8sStatus.Failed, k8sStatus.Active)
		now := time.Now()
		if k8sStatus.CompletionTime != nil {
			now = k8sStatus.CompletionTime.Time
		}
		job.CompletedAt = &now
		job.Status = JobStatusFailed
		err := UpdateReprocessingJobStatus(m.dbpool, job.ID, JobStatusFailed, nil, &now, "K8s job has failed pods")
		if err != nil {
			m.Errorf("[enrichJobWithK8sStatusWithContext] Failed to update job %s status to failed: %v", job.ID, err)
		} else {
			m.Infof("[enrichJobWithK8sStatusWithContext] Job %s marked as failed based on K8s status (failed=%d, active=%d)", job.ID, k8sStatus.Failed, k8sStatus.Active)
		}
	} else if allSucceeded || k8sJobCompleted {
		// All workers succeeded OR K8s job is complete - mark as completed
		m.Infof("[enrichJobWithK8sStatusWithContext] Marking job %s as completed (succeeded=%d, active=%d)", job.ID, k8sStatus.Succeeded, k8sStatus.Active)
		now := time.Now()
		if k8sStatus.CompletionTime != nil {
			now = k8sStatus.CompletionTime.Time
		}
		job.CompletedAt = &now
		job.Status = JobStatusCompleted
		err := UpdateReprocessingJobStatus(m.dbpool, job.ID, JobStatusCompleted, nil, &now, "")
		if err != nil {
			m.Errorf("[enrichJobWithK8sStatusWithContext] Failed to update job %s status to completed: %v", job.ID, err)
		} else {
			m.Infof("[enrichJobWithK8sStatusWithContext] Job %s marked as completed based on K8s status (succeeded=%d, active=%d, completion_time=%v)",
				job.ID, k8sStatus.Succeeded, k8sStatus.Active, k8sStatus.CompletionTime != nil)
		}
	}

	return nil
}

// checkCompletionFromWorkers checks worker statuses to determine if job is complete
func (m *ReprocessingJobManager) checkCompletionFromWorkers(job *ReprocessingJob) error {
	m.Infof("[checkCompletionFromWorkers] Starting for job %s", job.ID)

	workers, err := GetAllWorkerStatuses(m.dbpool, job.ID)
	if err != nil {
		m.Errorf("[checkCompletionFromWorkers] Failed to get worker statuses for job %s: %v", job.ID, err)
		return fmt.Errorf("failed to get worker statuses: %w", err)
	}
	m.Infof("[checkCompletionFromWorkers] Retrieved %d worker statuses for job %s", len(workers), job.ID)

	if len(workers) == 0 {
		// No workers found - cannot determine completion
		m.Warnf("[checkCompletionFromWorkers] No workers found for job %s, cannot determine completion", job.ID)
		return nil
	}

	completedCount := 0
	failedCount := 0

	for _, worker := range workers {
		status, ok := worker["status"].(string)
		if !ok {
			continue
		}
		if status == "completed" {
			completedCount++
		} else if status == "failed" {
			failedCount++
		}
	}

	m.Infof("[checkCompletionFromWorkers] Worker status for job %s: completed=%d, failed=%d, total=%d", job.ID, completedCount, failedCount, len(workers))

	// If all workers are completed or failed, mark the job accordingly
	if completedCount+failedCount == job.TotalWorkers {
		m.Infof("[checkCompletionFromWorkers] All workers done for job %s, updating job status", job.ID)
		now := time.Now()
		job.CompletedAt = &now

		if failedCount > 0 {
			m.Infof("[checkCompletionFromWorkers] Marking job %s as failed (failed=%d)", job.ID, failedCount)
			job.Status = JobStatusFailed
			err := UpdateReprocessingJobStatus(m.dbpool, job.ID, JobStatusFailed, nil, &now, fmt.Sprintf("%d workers failed", failedCount))
			if err != nil {
				m.Errorf("[checkCompletionFromWorkers] Failed to update job %s status to failed: %v", job.ID, err)
			} else {
				m.Infof("[checkCompletionFromWorkers] Job %s marked as failed based on worker statuses (failed=%d)", job.ID, failedCount)
			}
		} else {
			m.Infof("[checkCompletionFromWorkers] Marking job %s as completed (completed=%d)", job.ID, completedCount)
			job.Status = JobStatusCompleted
			err := UpdateReprocessingJobStatus(m.dbpool, job.ID, JobStatusCompleted, nil, &now, "")
			if err != nil {
				m.Errorf("[checkCompletionFromWorkers] Failed to update job %s status to completed: %v", job.ID, err)
			} else {
				m.Infof("[checkCompletionFromWorkers] Job %s marked as completed based on worker statuses (completed=%d)", job.ID, completedCount)
			}
		}
	} else {
		m.Infof("[checkCompletionFromWorkers] Not all workers done for job %s yet (completed+failed=%d, total=%d)",
			job.ID, completedCount+failedCount, job.TotalWorkers)
	}

	return nil
}

// GetJobWorkers returns worker status for a job
func (m *ReprocessingJobManager) GetJobWorkers(id string) ([]map[string]interface{}, error) {
	return GetAllWorkerStatuses(m.dbpool, id)
}

// ListJobs returns all jobs with enriched K8s status
func (m *ReprocessingJobManager) ListJobs() []*ReprocessingJob {
	m.Infof("[ListJobs] Starting")

	// Create context with timeout for database query
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	m.Infof("[ListJobs] Querying database for jobs")
	jobs, err := ListReprocessingJobs(ctx, m.dbpool)
	if err != nil {
		m.Errorf("[ListJobs] Failed to list jobs from database: %v", err)
		return []*ReprocessingJob{}
	}
	m.Infof("[ListJobs] Retrieved %d jobs from database", len(jobs))

	// Enrich running jobs with K8s status to detect completion
	if m.k8sClient != nil {
		runningJobCount := 0
		for _, job := range jobs {
			if job.Status == JobStatusRunning && job.K8sJobName != "" {
				runningJobCount++
			}
		}
		m.Infof("[ListJobs] Found %d running jobs to enrich with K8s status", runningJobCount)

		for i, job := range jobs {
			if job.Status == JobStatusRunning && job.K8sJobName != "" {
				m.Infof("[ListJobs] Enriching job %d/%d: %s (k8s_job=%s)", i+1, runningJobCount, job.ID, job.K8sJobName)
				if err := m.enrichJobWithK8sStatus(job); err != nil {
					// Log but don't fail
					m.Warnf("[ListJobs] Failed to get K8s status for job %s: %v", job.ID, err)
				} else {
					m.Infof("[ListJobs] Successfully enriched job %s, new status=%s", job.ID, job.Status)
				}
			}
		}
		m.Infof("[ListJobs] Finished enriching %d running jobs", runningJobCount)
	} else {
		m.Infof("[ListJobs] No K8s client available, skipping enrichment")
	}

	m.Infof("[ListJobs] Completed, returning %d jobs", len(jobs))
	return jobs
}

// CancelJob cancels a job
func (m *ReprocessingJobManager) CancelJob(id string) error {
	m.Infof("[CancelJob] Starting for job %s", id)

	job, err := m.GetJob(id)
	if err != nil {
		m.Errorf("[CancelJob] Failed to get job %s: %v", id, err)
		return err
	}

	if job.Status == JobStatusCompleted || job.Status == JobStatusCancelled {
		m.Warnf("[CancelJob] Job %s is already finished (status=%s)", id, job.Status)
		return fmt.Errorf("job %s is already finished", id)
	}

	// Delete the K8s job
	ctx := context.Background()
	if job.K8sJobName == "" {
		m.Warnf("[CancelJob] Job %s has no K8s job name, cannot delete K8s resources", id)
	} else {
		m.Infof("[CancelJob] Deleting K8s job %s for job %s", job.K8sJobName, id)
		err = m.k8sClient.DeleteJob(ctx, job.K8sJobName, job.ID)
		if err != nil {
			m.Warnf("[CancelJob] Failed to delete K8s job %s: %v", job.K8sJobName, err)
		} else {
			m.Infof("[CancelJob] Successfully deleted K8s job %s", job.K8sJobName)
		}
	}

	// Update status in database
	m.Infof("[CancelJob] Updating job %s status to cancelled", id)
	now := time.Now()
	err = UpdateReprocessingJobStatus(m.dbpool, id, JobStatusCancelled, nil, &now, "")
	if err != nil {
		m.Errorf("[CancelJob] Failed to update job %s status: %v", id, err)
		return fmt.Errorf("failed to update job status: %w", err)
	}

	m.Infof("[CancelJob] Successfully cancelled job %s", id)
	return nil
}

// Close shuts down the reprocessing job manager
func (m *ReprocessingJobManager) Close() error {
	m.Infof("Shutting down reprocessing job manager")
	return nil
}

// listS3Files lists all NDJSON files in the S3 path
func (m *ReprocessingJobManager) listS3Files(ctx context.Context, s3Path string) ([]FileItem, error) {
	// Parse S3 path (s3://bucket/prefix)
	parts := strings.SplitN(strings.TrimPrefix(s3Path, "s3://"), "/", 2)
	if len(parts) < 1 {
		return nil, fmt.Errorf("invalid S3 path: %s", s3Path)
	}

	bucket := parts[0]
	prefix := ""
	if len(parts) > 1 {
		prefix = parts[1]
	}

	var files []FileItem
	paginator := s3.NewListObjectsV2Paginator(m.s3Client, &s3.ListObjectsV2Input{
		Bucket: aws.String(bucket),
		Prefix: aws.String(prefix),
	})

	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, err
		}

		for _, obj := range page.Contents {
			key := *obj.Key
			if strings.HasSuffix(key, ".ndjson") || strings.HasSuffix(key, ".ndjson.gz") {
				files = append(files, FileItem{
					Path:         fmt.Sprintf("s3://%s/%s", bucket, key),
					Size:         *obj.Size,
					LastModified: *obj.LastModified,
				})
			}
		}
	}

	// Sort by path for consistent processing order
	sort.Slice(files, func(i, j int) bool {
		return files[i].Path < files[j].Path
	})

	return files, nil
}

// listLocalFiles lists all NDJSON files in the local path recursively
func (m *ReprocessingJobManager) listLocalFiles(localPath string) ([]FileItem, error) {
	var files []FileItem

	err := filepath.Walk(localPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		// Skip directories
		if info.IsDir() {
			return nil
		}

		// Only include ndjson and ndjson.gz files
		if strings.HasSuffix(path, ".ndjson") || strings.HasSuffix(path, ".ndjson.gz") {
			files = append(files, FileItem{
				Path:         path,
				Size:         info.Size(),
				LastModified: info.ModTime(),
			})
		}

		return nil
	})

	if err != nil {
		return nil, err
	}

	// Sort files by path for consistent processing order
	sort.Slice(files, func(i, j int) bool {
		return files[i].Path < files[j].Path
	})

	return files, nil
}

// parseFilenameTimestamp extracts timestamp from failover log filename using regex
// Looks for pattern: YYYY_MM_DDTHH_MM_SS anywhere in the filename
func parseFilenameTimestamp(filename string) (time.Time, error) {
	base := filepath.Base(filename)

	// Find timestamp pattern in filename
	matches := timestampRegex.FindStringSubmatch(base)
	if matches == nil || len(matches) != 2 {
		return time.Time{}, fmt.Errorf("no timestamp pattern (YYYY_MM_DDTHH_MM_SS) found in filename: %s", filename)
	}

	// Parse the timestamp
	t, err := time.Parse("2006_01_02T15_04_05", matches[1])
	if err != nil {
		return time.Time{}, fmt.Errorf("failed to parse timestamp from filename %s: %w", filename, err)
	}

	return t, nil
}

// filterFilesByDateRange filters files based on date range overlap
// A file is included if its time span overlaps with the requested date range:
// - File creation time (from filename) <= dateTo
// - File modification time >= dateFrom
func (m *ReprocessingJobManager) filterFilesByDateRange(ctx context.Context, files []FileItem, dateFrom, dateTo time.Time) ([]FileItem, error) {
	var filteredFiles []FileItem

	for _, fileItem := range files {
		// Parse timestamp from filename (file creation time)
		createdTime, err := parseFilenameTimestamp(fileItem.Path)
		if err != nil {
			// If we can't parse the filename, skip this file
			m.Warnf("Skipping file with unparseable filename: %s: %v", fileItem.Path, err)
			continue
		}

		// Skip if file was created day later than the end of requested range
		// batches that was created after end of the period may still contain events from the period
		if !dateTo.IsZero() && createdTime.Add(time.Hour*-24).After(dateTo) {
			continue
		}

		// Skip if file was last modified before the start of requested range
		if !dateFrom.IsZero() && fileItem.LastModified.Before(dateFrom) {
			continue
		}

		filteredFiles = append(filteredFiles, fileItem)
	}

	return filteredFiles, nil
}

// filterFilesByList filters files to only include those in the provided list
// Matches either the full path or just the filename
func (m *ReprocessingJobManager) filterFilesByList(files []FileItem, fileList []string) []FileItem {
	// Build a map for fast lookup (both full paths and basenames)
	fileMap := make(map[string]bool)
	for _, f := range fileList {
		f = strings.TrimSpace(f)
		if f != "" {
			fileMap[f] = true
			// Also add just the basename for convenience
			fileMap[filepath.Base(f)] = true
		}
	}

	var filteredFiles []FileItem
	for _, fileItem := range files {
		// Check if the full path matches
		if fileMap[fileItem.Path] {
			filteredFiles = append(filteredFiles, fileItem)
			continue
		}
		// Check if just the filename matches
		if fileMap[filepath.Base(fileItem.Path)] {
			filteredFiles = append(filteredFiles, fileItem)
			continue
		}
	}

	m.Infof("Filtered %d files to %d files based on provided file list", len(files), len(filteredFiles))
	return filteredFiles
}
