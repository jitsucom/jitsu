package main

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"time"

	"github.com/gin-gonic/gin"
)

// ReprocessingStartRequest represents a request to start a reprocessing job
type ReprocessingStartRequest struct {
	S3Path            string         `json:"s3_path,omitempty"`
	LocalPath         string         `json:"local_path,omitempty"`
	StreamIds         StreamSelector `json:"stream_ids,omitempty"`
	Files             []string       `json:"files,omitempty"`
	DryRun            bool           `json:"dry_run"`
	StartFile         string         `json:"start_file,omitempty"`
	StartLine         int64          `json:"start_line,omitempty"`
	BatchSize         int            `json:"batch_size,omitempty"`
	RetryAttempts     int            `json:"retry_attempts,omitempty"`
	DateFrom          time.Time      `json:"date_from,omitempty"`
	DateTo            time.Time      `json:"date_to,omitempty"`
	Limit             int64          `json:"limit,omitempty"`
	ParallelWorkers   int            `json:"parallel_workers,omitempty"`
	ConnectionsFilter bool           `json:"connections_filter,omitempty"`
}

// ReprocessingJobResponse represents a job in API responses
type ReprocessingJobResponse struct {
	ID               string                `json:"id"`
	Status           ReprocessingJobStatus `json:"status"`
	Config           ReprocessingJobConfig `json:"config"`
	CreatedAt        string                `json:"created_at"`
	StartedAt        string                `json:"started_at,omitempty"`
	CompletedAt      string                `json:"completed_at,omitempty"`
	CurrentFile      string                `json:"current_file,omitempty"`
	CurrentLine      int64                 `json:"current_line"`
	CurrentTimestamp string                `json:"current_timestamp,omitempty"`
	TotalFiles       int                   `json:"total_files"`
	ProcessedFiles   int                   `json:"processed_files"`
	TotalLines       int64                 `json:"total_lines"`
	SuccessCount     int64                 `json:"success_count"`
	ErrorCount       int64                 `json:"error_count"`
	SkippedCount     int64                 `json:"skipped_count"`
	ProcessedBytes   int64                 `json:"processed_bytes"`
	LastError        string                `json:"last_error,omitempty"`
	Progress         float64               `json:"progress"`
	TotalWorkers     int                   `json:"total_workers,omitempty"`
	K8sJobName       string                `json:"k8s_job_name,omitempty"`
	K8sJobStatus     *K8sJobStatusInfo     `json:"k8s_job_status,omitempty"`
}

// K8sJobStatusInfo contains Kubernetes Job status information
type K8sJobStatusInfo struct {
	Active         int32  `json:"active"`          // Number of active pods
	Succeeded      int32  `json:"succeeded"`       // Number of succeeded pods
	Failed         int32  `json:"failed"`          // Number of failed pods
	Ready          *int32 `json:"ready,omitempty"` // Number of ready pods
	CompletionTime string `json:"completion_time,omitempty"`
	StartTime      string `json:"start_time,omitempty"`
}

// jobToResponse converts a ReprocessingJob to a response format
func jobToResponse(job *ReprocessingJob) ReprocessingJobResponse {
	resp := ReprocessingJobResponse{
		ID:               job.ID,
		Status:           job.Status,
		Config:           job.Config,
		CreatedAt:        job.CreatedAt.Format("2006-01-02T15:04:05Z"),
		CurrentFile:      job.CurrentFile,
		CurrentLine:      job.CurrentLine,
		CurrentTimestamp: job.CurrentTimestamp,
		TotalFiles:       job.TotalFiles,
		ProcessedFiles:   job.ProcessedFiles,
		TotalLines:       job.TotalLines,
		SuccessCount:     job.SuccessCount,
		ErrorCount:       job.ErrorCount,
		SkippedCount:     job.SkippedCount,
		ProcessedBytes:   job.ProcessedBytes,
		LastError:        job.LastError,
		TotalWorkers:     job.TotalWorkers,
		K8sJobName:       job.K8sJobName,
	}

	if job.StartedAt != nil {
		resp.StartedAt = job.StartedAt.Format("2006-01-02T15:04:05Z")
	}
	if job.CompletedAt != nil {
		resp.CompletedAt = job.CompletedAt.Format("2006-01-02T15:04:05Z")
	}

	// Calculate progress
	if job.TotalFiles > 0 {
		resp.Progress = float64(job.ProcessedFiles) / float64(job.TotalFiles)
	}

	return resp
}

// jobToResponseWithK8sStatus converts a ReprocessingJob to a response format with K8s status
func jobToResponseWithK8sStatus(job *ReprocessingJob, k8sStatus *K8sJobStatusInfo) ReprocessingJobResponse {
	resp := jobToResponse(job)
	resp.K8sJobStatus = k8sStatus
	return resp
}

// getK8sJobStatusInfo fetches K8s job status information
func (r *Router) getK8sJobStatusInfo(jobName string) *K8sJobStatusInfo {
	if r.context.k8sClient == nil {
		return nil
	}

	ctx := context.Background()
	k8sStatus, err := r.context.k8sClient.GetJobStatus(ctx, jobName)
	if err != nil {
		// Log but don't fail - return nil
		return nil
	}

	info := &K8sJobStatusInfo{
		Active:    k8sStatus.Active,
		Succeeded: k8sStatus.Succeeded,
		Failed:    k8sStatus.Failed,
		Ready:     k8sStatus.Ready,
	}

	if k8sStatus.StartTime != nil {
		info.StartTime = k8sStatus.StartTime.Format("2006-01-02T15:04:05Z")
	}
	if k8sStatus.CompletionTime != nil {
		info.CompletionTime = k8sStatus.CompletionTime.Format("2006-01-02T15:04:05Z")
	}

	return info
}

// startReprocessingJob starts a new reprocessing job
func (r *Router) startReprocessingJob(c *gin.Context) {
	var req ReprocessingStartRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get or create reprocessing manager
	manager := r.getReprocessingManager()
	if manager == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "reprocessing manager not initialized"})
		return
	}

	// Create job config
	config := ReprocessingJobConfig{
		S3Path:            req.S3Path,
		LocalPath:         req.LocalPath,
		StreamIds:         req.StreamIds,
		Files:             req.Files,
		DryRun:            req.DryRun,
		StartFile:         req.StartFile,
		StartLine:         req.StartLine,
		BatchSize:         req.BatchSize,
		RetryAttempts:     req.RetryAttempts,
		DateFrom:          req.DateFrom,
		DateTo:            req.DateTo,
		Limit:             req.Limit,
		ParallelWorkers:   req.ParallelWorkers,
		ConnectionsFilter: req.ConnectionsFilter,
	}

	// Start job
	job, err := manager.StartJob(config)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, jobToResponse(job))
}

// listReprocessingJobs lists all reprocessing jobs
func (r *Router) listReprocessingJobs(c *gin.Context) {

	manager := r.getReprocessingManager()
	if manager == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "reprocessing manager not initialized"})
		return
	}

	jobs := manager.ListJobs()

	// Sort jobs by created date (newest first)
	sort.Slice(jobs, func(i, j int) bool {
		return jobs[i].CreatedAt.After(jobs[j].CreatedAt)
	})

	responses := make([]ReprocessingJobResponse, len(jobs))
	for i, job := range jobs {
		responses[i] = jobToResponse(job)
	}

	c.JSON(http.StatusOK, gin.H{"jobs": responses})
}

// getReprocessingJob gets a specific reprocessing job
func (r *Router) getReprocessingJob(c *gin.Context) {
	jobId := c.Param("id")
	if jobId == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "job id required"})
		return
	}

	manager := r.getReprocessingManager()
	if manager == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "reprocessing manager not initialized"})
		return
	}

	job, err := manager.GetJob(jobId)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	// Get K8s job status if available
	var k8sStatusInfo *K8sJobStatusInfo
	if job.K8sJobName != "" && r.context.k8sClient != nil {
		k8sStatusInfo = r.getK8sJobStatusInfo(job.K8sJobName)
	}

	c.JSON(http.StatusOK, jobToResponseWithK8sStatus(job, k8sStatusInfo))
}

// getJobWorkers gets worker status for a job
func (r *Router) getJobWorkers(c *gin.Context) {
	jobId := c.Param("id")
	if jobId == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "job id required"})
		return
	}

	manager := r.getReprocessingManager()
	if manager == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "reprocessing manager not initialized"})
		return
	}

	workers, err := manager.GetJobWorkers(jobId)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"workers": workers})
}

// cancelReprocessingJob cancels a job
func (r *Router) cancelReprocessingJob(c *gin.Context) {
	jobId := c.Param("id")
	if jobId == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "job id required"})
		return
	}

	manager := r.getReprocessingManager()
	if manager == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "reprocessing manager not initialized"})
		return
	}

	if err := manager.CancelJob(jobId); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	job, _ := manager.GetJob(jobId)
	c.JSON(http.StatusOK, jobToResponse(job))
}

// getReprocessingManager gets or creates the reprocessing manager
func (r *Router) getReprocessingManager() *ReprocessingJobManager {
	return r.reprocessingManager
}

// serveAdminHTML serves the HTML interface for admin
func (r *Router) serveAdminHTML(c *gin.Context) {
	htmlContent := `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Bulker Admin</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background-color: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        h1 {
            margin-top: 0;
            color: #333;
        }
        .auth-section {
            background-color: #f9f9f9;
            padding: 15px;
            border-radius: 4px;
            margin-bottom: 20px;
        }
        .auth-section input[type="password"] {
            width: 300px;
            padding: 8px;
            margin-left: 10px;
            border: 1px solid #ddd;
            border-radius: 4px;
        }
        .section {
            margin-bottom: 30px;
        }
        .job-form {
            background-color: #f9f9f9;
            padding: 15px;
            border-radius: 4px;
            margin-bottom: 20px;
        }
        .form-group {
            margin-bottom: 15px;
        }
        .form-group label {
            display: inline-block;
            width: 150px;
            font-weight: bold;
        }
        .form-group input, .form-group textarea {
            width: 300px;
            padding: 5px;
            border: 1px solid #ddd;
            border-radius: 4px;
        }
        .form-group textarea {
            vertical-align: top;
            height: 60px;
        }
        .form-group input[type="checkbox"] {
            width: auto;
        }
        .date-help {
            font-size: 12px;
            color: #666;
            margin-top: 5px;
        }
        table {
            width: 100%;
            border-collapse: collapse;
        }
        th, td {
            text-align: left;
            padding: 10px;
            border-bottom: 1px solid #ddd;
        }
        th {
            background-color: #f0f0f0;
            font-weight: bold;
        }
        .status {
            padding: 3px 8px;
            border-radius: 3px;
            font-size: 12px;
            font-weight: bold;
        }
        .status-pending { background-color: #ffc107; color: white; }
        .status-running { background-color: #28a745; color: white; }
        .status-completed { background-color: #6c757d; color: white; }
        .status-failed { background-color: #dc3545; color: white; }
        .status-cancelled { background-color: #6c757d; color: white; }
        .actions button {
            margin-right: 5px;
            padding: 5px 10px;
            font-size: 12px;
            border: none;
            border-radius: 3px;
            cursor: pointer;
        }
        .btn-cancel { background-color: #dc3545; color: white; }
        .btn-refresh { background-color: #007bff; color: white; }
        .btn-logs { background-color: #28a745; color: white; margin-right: 5px; }
        .btn-prefill { background-color: #6f42c1; color: white; margin-right: 5px; }
        .btn-expand {
            background: none;
            border: 1px solid #dee2e6;
            color: #495057;
            font-size: 12px;
            padding: 2px 6px;
            margin-right: 8px;
            cursor: pointer;
            border-radius: 3px;
            font-family: monospace;
            min-width: 20px;
            text-align: center;
        }
        .btn-expand:hover {
            background-color: #e9ecef;
        }
        .progress-bar {
            width: 100px;
            height: 10px;
            background-color: #e0e0e0;
            border-radius: 5px;
            overflow: hidden;
        }
        .progress-fill {
            height: 100%;
            background-color: #28a745;
            transition: width 0.3s ease;
        }
        .job-details {
            background-color: #f8f9fa;
            padding: 0;
            margin: 0;
        }
        .job-details pre {
            background-color: #fff;
            border: 1px solid #dee2e6;
            border-radius: 4px;
            padding: 10px;
            margin: 0;
            overflow-x: auto;
            font-size: 12px;
        }
        tr.expandable {
            cursor: pointer;
        }
        tr.expanded {
            background-color: #f0f0f0;
        }
        td span[title] {
            cursor: help;
            text-decoration: underline dotted;
        }
        .error-message {
            color: #dc3545;
            margin-top: 10px;
            padding: 10px;
            background-color: #f8d7da;
            border-radius: 4px;
            display: none;
        }
        .success-message {
            color: #155724;
            margin-top: 10px;
            padding: 10px;
            background-color: #d4edda;
            border-radius: 4px;
            display: none;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Bulker Admin - Reprocessing Jobs</h1>
        
        <div class="auth-section">
            <label for="authToken">Auth Token:</label>
            <input type="password" id="authToken" placeholder="Enter your auth token">
        </div>

        <div class="section">
            <h2>Start New Reprocessing Job</h2>
            <div class="job-form">
                <div class="form-group">
                    <label for="s3Path">S3 Path:</label>
                    <input type="text" id="s3Path" placeholder="s3://bucket/path">
                </div>
                <div class="form-group">
                    <label for="localPath">Local Path:</label>
                    <input type="text" id="localPath" placeholder="/path/to/files">
                </div>
                <div class="form-group">
                    <label for="streamIds">Stream IDs:</label>
                    <textarea id="streamIds" placeholder='One per line, or JSON: {"stream1": ["con1", "con2"], "stream2": "con3", "*": "*"}'></textarea>
                    <div class="date-help">
                        Plain list — reprocess these streams to their mapped connections.<br>
                        JSON map — stream id (or "*" for every stream) to connection ids, applied per the mode below.
                        A value may be one id or a list; the id "*" means the stream's mapped connections.<br>
                        Either way only the listed streams are reprocessed; leave empty for all streams.
                    </div>
                </div>
                <div class="form-group">
                    <label for="connectionsMode">Connections Mode (JSON form):</label>
                    <select id="connectionsMode">
                        <option value="override">Override — use listed connections instead of mapped ones</option>
                        <option value="filter">Filter — keep mapped connections only if listed</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="files">Files to Process:</label>
                    <textarea id="files" placeholder="One per line (optional filter)"></textarea>
                </div>
                <div class="form-group">
                    <label for="startFile">Start File:</label>
                    <input type="text" id="startFile" placeholder="Optional">
                </div>
                <div class="form-group">
                    <label for="startLine">Start Line:</label>
                    <input type="number" id="startLine" placeholder="0">
                </div>
                <div class="form-group">
                    <label for="batchSize">Batch Size:</label>
                    <input type="number" id="batchSize" placeholder="1000">
                </div>
                <div class="form-group">
                    <label for="retryAttempts">Retry Attempts:</label>
                    <input type="number" id="retryAttempts" placeholder="3 (default)">
                </div>
                <div class="form-group">
                    <label for="dateFrom">Date From (UTC):</label>
                    <input type="text" id="dateFrom" placeholder="YYYY-MM-DDTHH:MM:SSZ">
                    <div class="date-help">Example: 2024-01-15T10:30:00Z</div>
                </div>
                <div class="form-group">
                    <label for="dateTo">Date To (UTC):</label>
                    <input type="text" id="dateTo" placeholder="YYYY-MM-DDTHH:MM:SSZ">
                    <div class="date-help">Example: 2024-01-16T18:45:00Z</div>
                </div>
                <div class="form-group">
                    <label for="limit">Event Limit:</label>
                    <input type="number" id="limit" placeholder="Optional (e.g. 10000)">
                </div>
                <div class="form-group">
                    <label for="parallelWorkers">Parallel Workers:</label>
                    <input type="number" id="parallelWorkers" placeholder="Optional (default: server setting)">
                    <div class="date-help">Max worker pods running at once. Total workers still follows the file count.</div>
                </div>
                <div class="form-group">
                    <label for="dryRun">Dry Run:</label>
                    <input type="checkbox" id="dryRun">
                </div>
                <button onclick="startJob()" style="background-color: #28a745; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer;">Start Job</button>
            </div>
        </div>

        <div class="section">
            <h2>Running Jobs</h2>
            <button onclick="refreshJobs()" class="btn-refresh">Refresh</button>
            <div id="jobsTable" style="margin-top: 15px;">
                <table>
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Status</th>
                            <th>Progress</th>
                            <th>Files</th>
                            <th>Lines</th>
                            <th>Success/Error/Skipped</th>
                            <th>Current File</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody id="jobsTableBody">
                    </tbody>
                </table>
            </div>
        </div>

        <div class="error-message" id="errorMessage"></div>
        <div class="success-message" id="successMessage"></div>
    </div>

    <script>
        // Track expanded jobs in memory
        let expandedJobIds = [];
        
        function getAuthToken() {
            return document.getElementById('authToken').value;
        }
        
        function validateISODate(dateStr) {
            if (!dateStr) return true; // Empty is valid (optional field)
            const regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/;
            return regex.test(dateStr);
        }
        
        function toggleJobDetails(index, event) {
            event.stopPropagation();
            const detailsRow = document.getElementById('job-details-' + index);
            const expandBtn = event.target;
            const jobRow = document.querySelector('tr[data-job-index="' + index + '"]');
            
            if (detailsRow.style.display === 'none') {
                detailsRow.style.display = '';
                expandBtn.textContent = '[-]';
                jobRow.classList.add('expanded');
                // Add to expanded state
                const jobId = window.jobsData[index].id;
                if (!expandedJobIds.includes(jobId)) {
                    expandedJobIds.push(jobId);
                }
            } else {
                detailsRow.style.display = 'none';
                expandBtn.textContent = '[+]';
                jobRow.classList.remove('expanded');
                // Remove from expanded state
                const jobId = window.jobsData[index].id;
                const idx = expandedJobIds.indexOf(jobId);
                if (idx > -1) {
                    expandedJobIds.splice(idx, 1);
                }
            }
        }

        function showError(message) {
            const errorDiv = document.getElementById('errorMessage');
            errorDiv.textContent = message;
            errorDiv.style.display = 'block';
            setTimeout(() => {
                errorDiv.style.display = 'none';
            }, 5000);
        }

        function showSuccess(message) {
            const successDiv = document.getElementById('successMessage');
            successDiv.textContent = message;
            successDiv.style.display = 'block';
            setTimeout(() => {
                successDiv.style.display = 'none';
            }, 3000);
        }

        async function apiCall(method, endpoint, body = null) {
            const token = getAuthToken();
            if (!token) {
                showError('Please enter auth token');
                return null;
            }

            try {
                const options = {
                    method: method,
                    headers: {
                        'Authorization': 'Bearer ' + token,
                        'Content-Type': 'application/json'
                    }
                };
                
                if (body) {
                    options.body = JSON.stringify(body);
                }

                const response = await fetch('/api/admin/reprocessing' + endpoint, options);
                const data = await response.json();
                
                if (!response.ok) {
                    throw new Error(data.error || 'API request failed');
                }
                
                return data;
            } catch (error) {
                showError('API Error: ' + error.message);
                return null;
            }
        }

        async function startJob() {
            const files = document.getElementById('files').value.split('\n').filter(f => f.trim());

            // Stream IDs accepts a plain list (one per line), a JSON array of ids,
            // or a JSON map of stream id -> connection ids
            let streamIds = undefined;
            const streamIdsRaw = document.getElementById('streamIds').value.trim();
            if (streamIdsRaw.startsWith('[')) {
                try {
                    streamIds = JSON.parse(streamIdsRaw);
                } catch (e) {
                    showError('Stream IDs: invalid JSON: ' + e.message);
                    return;
                }
                if (streamIds.some(id => typeof id !== 'string')) {
                    showError('Stream IDs: JSON array form must contain stream id strings');
                    return;
                }
                // an explicit [] selects no streams — leave it intact, unlike an
                // empty field, which means "all streams"
            } else if (streamIdsRaw.startsWith('{')) {
                try {
                    streamIds = JSON.parse(streamIdsRaw);
                } catch (e) {
                    showError('Stream IDs: invalid JSON: ' + e.message);
                    return;
                }
                if (typeof streamIds !== 'object' || Array.isArray(streamIds)) {
                    showError('Stream IDs: JSON form must be an object: {"streamId": ["con1"]}');
                    return;
                }
                for (const [streamId, conns] of Object.entries(streamIds)) {
                    const valid = typeof conns === 'string' ||
                        (Array.isArray(conns) && conns.every(c => typeof c === 'string'));
                    if (!valid) {
                        showError('Stream IDs: value for "' + streamId + '" must be a connection id or a list of them');
                        return;
                    }
                }
            } else {
                const ids = streamIdsRaw.split('\n').map(id => id.trim()).filter(id => id);
                streamIds = ids.length > 0 ? ids : undefined;
            }

            // Validate date formats
            const dateFrom = document.getElementById('dateFrom').value;
            const dateTo = document.getElementById('dateTo').value;

            if (dateFrom && !validateISODate(dateFrom)) {
                showError('Date From must be in ISO format: YYYY-MM-DDTHH:MM:SSZ');
                return;
            }

            if (dateTo && !validateISODate(dateTo)) {
                showError('Date To must be in ISO format: YYYY-MM-DDTHH:MM:SSZ');
                return;
            }

            const jobData = {
                s3_path: document.getElementById('s3Path').value || undefined,
                local_path: document.getElementById('localPath').value || undefined,
                stream_ids: streamIds,
                files: files.length > 0 ? files : undefined,
                start_file: document.getElementById('startFile').value || undefined,
                start_line: parseInt(document.getElementById('startLine').value) || 0,
                batch_size: parseInt(document.getElementById('batchSize').value) || undefined,
                retry_attempts: parseInt(document.getElementById('retryAttempts').value) || undefined,
                date_from: document.getElementById('dateFrom').value || undefined,
                date_to: document.getElementById('dateTo').value || undefined,
                limit: parseInt(document.getElementById('limit').value) || undefined,
                parallel_workers: parseInt(document.getElementById('parallelWorkers').value) || undefined,
                connections_filter: document.getElementById('connectionsMode').value === 'filter' || undefined,
                dry_run: document.getElementById('dryRun').checked
            };

            // Remove undefined values
            Object.keys(jobData).forEach(key => jobData[key] === undefined && delete jobData[key]);

            const result = await apiCall('POST', '/jobs', jobData);
            if (result) {
                showSuccess('Job started: ' + result.id);
                refreshJobs();
                // Clear form
                document.querySelectorAll('.job-form input[type="text"], .job-form textarea').forEach(el => el.value = '');
                document.querySelectorAll('.job-form input[type="number"]').forEach(el => el.value = '');
                document.getElementById('connectionsMode').value = 'override';
                document.getElementById('dryRun').checked = false;
            }
        }

        let isRefreshing = false;
        let lastRefreshTime = 0;

        async function refreshJobs() {
            // Prevent concurrent requests
            if (isRefreshing) {
                console.log('[refreshJobs] Already refreshing, skipping request');
                return;
            }

            // Debounce: prevent refreshing more than once per second
            const now = Date.now();
            if (now - lastRefreshTime < 1000) {
                console.log('[refreshJobs] Debounced, last refresh was ' + (now - lastRefreshTime) + 'ms ago');
                return;
            }

            isRefreshing = true;
            lastRefreshTime = now;
            console.log('[refreshJobs] Starting refresh');

            try {
                const result = await apiCall('GET', '/jobs');
                if (result && result.jobs) {
                    displayJobs(result.jobs);
                    console.log('[refreshJobs] Successfully refreshed ' + result.jobs.length + ' jobs');
                }
            } catch (error) {
                console.error('[refreshJobs] Error:', error);
            } finally {
                isRefreshing = false;
            }
        }

        function displayJobs(jobs) {
            const tbody = document.getElementById('jobsTableBody');
            tbody.innerHTML = '';
            
            jobs.forEach((job, index) => {
                const row = document.createElement('tr');
                row.className = 'expandable';
                row.setAttribute('data-job-index', index);
                const progress = job.progress * 100;
                
                row.innerHTML = ` + "`" + `
                    <td>
                        <button class="btn-expand" onclick="toggleJobDetails(${index}, event)">[+]</button>
                        ${job.id.substring(0, 8)}...
                    </td>
                    <td><span class="status status-${job.status}">${job.status}</span></td>
                    <td>
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${progress}%"></div>
                        </div>
                        ${progress.toFixed(1)}%
                    </td>
                    <td>${job.processed_files}/${job.total_files}</td>
                    <td>${job.total_lines}</td>
                    <td>${job.success_count}/${job.error_count}/${job.skipped_count}</td>
                    <td>${job.current_file ? '<span title="' + job.current_file + '">' + job.current_file.split('/').pop() + '</span>' : '-'}</td>
                    <td class="actions">
                        <button class="btn-prefill" onclick="prefillForm(${index}, event)">Use as Template</button>
                        <button class="btn-logs" onclick="viewLogs('${job.id}')">View Logs</button>
                        ${job.status !== 'completed' && job.status !== 'cancelled' && job.status !== 'failed' ? '<button class="btn-cancel" onclick="cancelJob(\'' + job.id + '\')">Cancel</button>' : ''}
                    </td>
                ` + "`" + `;
                tbody.appendChild(row);
                
                // Add details row
                const detailsRow = document.createElement('tr');
                detailsRow.id = 'job-details-' + index;
                detailsRow.style.display = 'none';
                const detailsDiv = document.createElement('div');
                detailsDiv.className = 'job-details';
                const pre = document.createElement('pre');
                pre.textContent = JSON.stringify(job, null, 2);
                detailsDiv.appendChild(pre);
                
                detailsRow.innerHTML = '<td colspan="8"></td>';
                detailsRow.querySelector('td').appendChild(detailsDiv);
                tbody.appendChild(detailsRow);
            });
            
            // Store jobs data for toggle function
            window.jobsData = jobs;
            
            // Restore expanded state from in-memory array
            jobs.forEach((job, index) => {
                if (expandedJobIds.includes(job.id)) {
                    const detailsRow = document.getElementById('job-details-' + index);
                    const expandBtn = document.querySelector('tr[data-job-index="' + index + '"] .btn-expand');
                    const jobRow = document.querySelector('tr[data-job-index="' + index + '"]');
                    
                    if (detailsRow && expandBtn && jobRow) {
                        detailsRow.style.display = '';
                        expandBtn.textContent = '[-]';
                        jobRow.classList.add('expanded');
                    }
                }
            });
        }

        // Fill the "Start New Reprocessing Job" form with the settings of a previous run
        function prefillForm(index, event) {
            if (event) {
                event.stopPropagation();
            }
            const job = window.jobsData && window.jobsData[index];
            if (!job || !job.config) {
                showError('No configuration available for this job');
                return;
            }
            const cfg = job.config;

            const setValue = (elementId, value) => {
                document.getElementById(elementId).value = value === undefined || value === null ? '' : value;
            };
            const setLines = (elementId, list) => {
                setValue(elementId, Array.isArray(list) ? list.join('\n') : '');
            };
            // Go serializes zero times as 0001-01-01T00:00:00Z — treat those as unset
            const setDate = (elementId, value) => {
                setValue(elementId, value && !value.startsWith('0001-01-01') ? value : '');
            };

            setValue('s3Path', cfg.s3_path);
            setValue('localPath', cfg.local_path);
            // stream_ids is either a list of ids or a map of id -> connection ids
            if (cfg.stream_ids && !Array.isArray(cfg.stream_ids)) {
                setValue('streamIds', JSON.stringify(cfg.stream_ids, null, 2));
            } else if (Array.isArray(cfg.stream_ids) && cfg.stream_ids.length === 0) {
                // Explicit empty selection: keep it as JSON. An empty textarea
                // would submit as "no selector", broadening the replay from
                // "no streams" to "every stream".
                setValue('streamIds', '[]');
            } else {
                setLines('streamIds', cfg.stream_ids);
            }
            document.getElementById('connectionsMode').value = cfg.connections_filter ? 'filter' : 'override';
            setLines('files', cfg.files);
            setValue('startFile', cfg.start_file);
            setValue('startLine', cfg.start_line);
            setValue('batchSize', cfg.batch_size);
            setValue('retryAttempts', cfg.retry_attempts);
            setDate('dateFrom', cfg.date_from);
            setDate('dateTo', cfg.date_to);
            setValue('limit', cfg.limit);
            setValue('parallelWorkers', cfg.parallel_workers);
            document.getElementById('dryRun').checked = !!cfg.dry_run;

            document.querySelector('.job-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
            showSuccess('Form filled from job ' + job.id.substring(0, 8) + '. Review the settings before starting.');
        }

        function viewLogs(jobId) {
            const token = getAuthToken();
            if (!token) {
                showError('Please enter auth token');
                return;
            }
            const url = '/api/admin/reprocessing/jobs/' + jobId + '/logs/view?token=' + encodeURIComponent(token);
            window.open(url, 'jobLogs_' + jobId, 'width=1200,height=800,scrollbars=yes,resizable=yes');
        }

        async function cancelJob(jobId) {
            if (confirm('Are you sure you want to cancel this job?')) {
                const result = await apiCall('POST', '/jobs/' + jobId + '/cancel');
                if (result) {
                    showSuccess('Job cancelled');
                    refreshJobs();
                }
            }
        }

        // Auto-refresh jobs every 1 minute, but only when tab is visible
        let refreshInterval = setInterval(() => {
            if (!document.hidden) {
                refreshJobs();
            } else {
                console.log('[Auto-refresh] Tab hidden, skipping refresh');
            }
        }, 60000);

        // Refresh when tab becomes visible after being hidden
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                console.log('[Visibility] Tab visible, refreshing');
                refreshJobs();
            }
        });

        // Initial load
        refreshJobs();
    </script>
</body>
</html>`

	c.Header("Content-Type", "text/html")
	c.String(http.StatusOK, htmlContent)
}

// getJobLogs returns logs from all worker pods for a job
func (r *Router) getJobLogs(c *gin.Context) {
	jobID := c.Param("id")

	// Get tail lines parameter (default 50)
	tailLines := int64(50)
	if tail := c.Query("tail"); tail != "" {
		if _, err := fmt.Sscanf(tail, "%d", &tailLines); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid tail parameter"})
			return
		}
	}

	// Get sinceSeconds parameter for incremental updates
	var sinceSeconds *int64
	if since := c.Query("since"); since != "" {
		var s int64
		if _, err := fmt.Sscanf(since, "%d", &s); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid since parameter"})
			return
		}
		sinceSeconds = &s
	}

	if r.context.k8sClient == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "kubernetes client not available"})
		return
	}

	// Check if sorted view is requested
	sortByTime := c.Query("sort") == "true"

	if sortByTime {
		// Return logs sorted by timestamp
		sortedLogs, err := r.context.k8sClient.GetJobLogsSorted(c.Request.Context(), jobID, tailLines, sinceSeconds)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("failed to get logs: %v", err)})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"job_id": jobID,
			"sorted": true,
			"lines":  sortedLogs,
		})
	} else {
		// Return logs grouped by worker
		logs, err := r.context.k8sClient.GetJobLogs(c.Request.Context(), jobID, tailLines, sinceSeconds)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("failed to get logs: %v", err)})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"job_id": jobID,
			"sorted": false,
			"logs":   logs,
		})
	}
}

// viewJobLogs serves an HTML page to view job logs in real-time
func (r *Router) viewJobLogs(c *gin.Context) {
	jobID := c.Param("id")

	htmlContent := `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Job Logs - ` + jobID + `</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: 'Courier New', monospace;
            background-color: #1e1e1e;
            color: #d4d4d4;
            padding: 20px;
        }
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 1px solid #3e3e3e;
        }
        h1 {
            font-size: 18px;
            color: #4ec9b0;
        }
        .controls {
            display: flex;
            gap: 10px;
            align-items: center;
        }
        .status {
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
        }
        .status.running {
            background-color: #4caf50;
            color: white;
        }
        .status.paused {
            background-color: #ff9800;
            color: white;
        }
        button {
            padding: 6px 12px;
            background-color: #0e639c;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
        }
        button:hover {
            background-color: #1177bb;
        }
        button.danger {
            background-color: #d32f2f;
        }
        button.danger:hover {
            background-color: #f44336;
        }
        .workers-container {
            display: flex;
            flex-direction: column;
            gap: 15px;
        }
        .worker-logs {
            background-color: #252526;
            border: 1px solid #3e3e3e;
            border-radius: 4px;
            overflow: hidden;
        }
        .worker-header {
            background-color: #2d2d30;
            padding: 10px 15px;
            border-bottom: 1px solid #3e3e3e;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .worker-title {
            font-weight: bold;
            color: #4ec9b0;
        }
        .worker-info {
            font-size: 11px;
            color: #858585;
        }
        .log-content {
            padding: 15px;
            max-height: 600px;
            overflow-y: auto;
            font-size: 12px;
            line-height: 1.5;
        }
        #sorted-logs {
            max-height: 80vh;
        }
        .log-line {
            margin-bottom: 2px;
            white-space: pre-wrap;
            word-wrap: break-word;
        }
        .log-line.error {
            color: #f48771;
        }
        .log-line.warning {
            color: #dcdcaa;
        }
        .log-line.info {
            color: #4fc1ff;
        }
        .error-message {
            color: #f48771;
            padding: 10px;
            background-color: #5a1d1d;
            border-radius: 4px;
            margin: 10px;
        }
        .no-logs {
            color: #858585;
            padding: 20px;
            text-align: center;
        }
        ::-webkit-scrollbar {
            width: 10px;
        }
        ::-webkit-scrollbar-track {
            background: #1e1e1e;
        }
        ::-webkit-scrollbar-thumb {
            background: #424242;
            border-radius: 5px;
        }
        ::-webkit-scrollbar-thumb:hover {
            background: #4e4e4e;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>Job Logs: ` + jobID + `</h1>
        <div class="controls">
            <span class="status running" id="refreshStatus">Auto-refresh: ON</span>
            <button onclick="toggleView()" id="viewToggle">Switch to Chronological</button>
            <button onclick="toggleRefresh()">Pause/Resume</button>
            <button onclick="clearLogs()">Clear</button>
            <button class="danger" onclick="window.close()">Close</button>
        </div>
    </div>
    <div class="workers-container" id="workersContainer">
        <div class="no-logs">Loading logs...</div>
    </div>

    <script>
        const jobId = '` + jobID + `';

        // Extract auth token from URL
        const urlParams = new URLSearchParams(window.location.search);
        const authToken = urlParams.get('token');
        if (!authToken) {
            document.getElementById('workersContainer').innerHTML = '<div class="error-message">Error: No authentication token provided</div>';
        }

        let autoRefresh = true;
        let refreshInterval;
        let workersData = {};
        let sortedLines = [];
        let seenLineHashes = new Set();
        let initialLoad = true;
        let viewMode = 'workers'; // 'workers' or 'sorted'

        function toggleRefresh() {
            autoRefresh = !autoRefresh;
            const status = document.getElementById('refreshStatus');
            if (autoRefresh) {
                status.textContent = 'Auto-refresh: ON';
                status.classList.add('running');
                status.classList.remove('paused');
                startAutoRefresh();
            } else {
                status.textContent = 'Auto-refresh: OFF';
                status.classList.remove('running');
                status.classList.add('paused');
                if (refreshInterval) {
                    clearInterval(refreshInterval);
                }
            }
        }

        function toggleView() {
            viewMode = viewMode === 'workers' ? 'sorted' : 'workers';
            const button = document.getElementById('viewToggle');
            button.textContent = viewMode === 'workers' ? 'Switch to Chronological' : 'Switch to Per-Worker';

            // Clear and reload
            workersData = {};
            sortedLines = [];
            seenLineHashes = new Set();
            initialLoad = true;
            document.getElementById('workersContainer').innerHTML = '<div class="no-logs">Loading logs...</div>';
            fetchLogs();
        }

        function clearLogs() {
            workersData = {};
            sortedLines = [];
            seenLineHashes = new Set();
            document.getElementById('workersContainer').innerHTML = '<div class="no-logs">Logs cleared. Will refresh in next update...</div>';
        }

        function classifyLogLine(line) {
            const lower = line.toLowerCase();
            if (lower.includes('error') || lower.includes('fatal') || lower.includes('panic')) {
                return 'error';
            }
            if (lower.includes('warn')) {
                return 'warning';
            }
            if (lower.includes('info')) {
                return 'info';
            }
            return '';
        }

        async function fetchLogs() {
            if (!authToken) {
                return;
            }

            try {
                const tailParam = initialLoad ? '?tail=50' : '?since=10';
                const sortParam = viewMode === 'sorted' ? '&sort=true' : '';
                const response = await fetch('/api/admin/reprocessing/jobs/' + jobId + '/logs' + tailParam + sortParam, {
                    headers: {
                        'Authorization': 'Bearer ' + authToken
                    }
                });
                if (!response.ok) {
                    throw new Error('Failed to fetch logs: ' + response.statusText);
                }
                const data = await response.json();

                if (data.sorted) {
                    updateSortedLogs(data.lines);
                } else {
                    updateWorkerLogs(data.logs);
                }

                initialLoad = false;
            } catch (error) {
                console.error('Error fetching logs:', error);
                document.getElementById('workersContainer').innerHTML =
                    '<div class="error-message">Error fetching logs: ' + error.message + '</div>';
            }
        }

        function updateWorkerLogs(logs) {
            if (!logs || logs.length === 0) {
                if (Object.keys(workersData).length === 0) {
                    document.getElementById('workersContainer').innerHTML = '<div class="no-logs">No workers or logs available yet.</div>';
                }
                return;
            }

            logs.forEach(workerLog => {
                const workerId = workerLog.worker_index;

                if (!workersData[workerId]) {
                    workersData[workerId] = {
                        podName: workerLog.pod_name,
                        lines: new Set(),
                        orderedLines: []
                    };
                }

                const worker = workersData[workerId];
                worker.podName = workerLog.pod_name;

                // Add new lines while avoiding duplicates
                if (workerLog.lines) {
                    workerLog.lines.forEach(line => {
                        if (line && !worker.lines.has(line)) {
                            worker.lines.add(line);
                            worker.orderedLines.push(line);
                        }
                    });
                }

                // Store error if present
                if (workerLog.error) {
                    worker.error = workerLog.error;
                }
            });

            renderWorkerLogs();
        }

        function updateSortedLogs(lines) {
            if (!lines || lines.length === 0) {
                if (sortedLines.length === 0) {
                    document.getElementById('workersContainer').innerHTML = '<div class="no-logs">No logs available yet.</div>';
                }
                return;
            }

            // Add new lines while avoiding duplicates
            lines.forEach(line => {
                // Create a hash from timestamp + worker + message to detect duplicates
                const hash = line.timestamp + '|' + line.worker_index + '|' + line.message;
                if (!seenLineHashes.has(hash)) {
                    seenLineHashes.add(hash);
                    sortedLines.push(line);
                }
            });

            renderSortedLogs();
        }

        function renderWorkerLogs() {
            const container = document.getElementById('workersContainer');
            const workerIds = Object.keys(workersData).sort((a, b) => parseInt(a) - parseInt(b));

            if (workerIds.length === 0) {
                container.innerHTML = '<div class="no-logs">No workers available yet.</div>';
                return;
            }

            let html = '';
            workerIds.forEach(workerId => {
                const worker = workersData[workerId];
                const lineCount = worker.orderedLines.length;

                html += '<div class="worker-logs">';
                html += '<div class="worker-header">';
                html += '<div class="worker-title">Worker ' + workerId + '</div>';
                html += '<div class="worker-info">Pod: ' + worker.podName + ' | Lines: ' + lineCount + '</div>';
                html += '</div>';

                if (worker.error) {
                    html += '<div class="error-message">' + worker.error + '</div>';
                } else if (worker.orderedLines.length > 0) {
                    html += '<div class="log-content" id="worker-' + workerId + '-logs">';
                    worker.orderedLines.forEach(line => {
                        const lineClass = classifyLogLine(line);
                        html += '<div class="log-line ' + lineClass + '">' + escapeHtml(line) + '</div>';
                    });
                    html += '</div>';
                } else {
                    html += '<div class="no-logs">No logs yet</div>';
                }

                html += '</div>';
            });

            container.innerHTML = html;

            // Auto-scroll to bottom for each worker
            workerIds.forEach(workerId => {
                const logContent = document.getElementById('worker-' + workerId + '-logs');
                if (logContent) {
                    logContent.scrollTop = logContent.scrollHeight;
                }
            });
        }

        function renderSortedLogs() {
            const container = document.getElementById('workersContainer');

            if (sortedLines.length === 0) {
                container.innerHTML = '<div class="no-logs">No logs available yet.</div>';
                return;
            }

            let html = '<div class="worker-logs">';
            html += '<div class="worker-header">';
            html += '<div class="worker-title">All Workers (Chronological Order)</div>';
            html += '<div class="worker-info">Total Lines: ' + sortedLines.length + '</div>';
            html += '</div>';
            html += '<div class="log-content" id="sorted-logs">';

            sortedLines.forEach(line => {
                const lineClass = classifyLogLine(line.message);
                const workerBadge = '<span style="color: #4ec9b0; margin-right: 10px;">[W' + line.worker_index + ']</span>';
                const timestamp = line.timestamp ? '<span style="color: #858585; margin-right: 10px;">' + escapeHtml(formatTimestamp(line.timestamp)) + '</span>' : '';
                html += '<div class="log-line ' + lineClass + '">' + timestamp + workerBadge + escapeHtml(line.message) + '</div>';
            });

            html += '</div>';
            html += '</div>';

            container.innerHTML = html;

            // Auto-scroll to bottom
            const logContent = document.getElementById('sorted-logs');
            if (logContent) {
                logContent.scrollTop = logContent.scrollHeight;
            }
        }

        function formatTimestamp(timestamp) {
            // Format: 2024-01-15T10:30:45.123456789Z -> 10:30:45.123
            if (!timestamp) return '';
            try {
                const date = new Date(timestamp);
                return date.toLocaleTimeString('en-US', { hour12: false }) + '.' + String(date.getMilliseconds()).padStart(3, '0');
            } catch (e) {
                return timestamp;
            }
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function startAutoRefresh() {
            if (refreshInterval) {
                clearInterval(refreshInterval);
            }
            refreshInterval = setInterval(() => {
                if (autoRefresh) {
                    fetchLogs();
                }
            }, 5000);
        }

        // Initial load
        if (authToken) {
            fetchLogs();
            startAutoRefresh();
        }
    </script>
</body>
</html>`

	c.Header("Content-Type", "text/html")
	c.String(http.StatusOK, htmlContent)
}
