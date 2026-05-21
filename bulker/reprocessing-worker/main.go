package main

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/confluentinc/confluent-kafka-go/v2/kafka"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jitsucom/bulker/jitsubase/jsonorder"
	"github.com/jitsucom/bulker/jitsubase/pg"
	"github.com/jitsucom/bulker/jitsubase/uuid"
	"github.com/jitsucom/bulker/kafkabase"
)

// FileItem represents a file to be processed
type FileItem struct {
	Path string `json:"path"`
	Size int64  `json:"size"`
}

// WorkerConfig contains configuration loaded from environment
type WorkerConfig struct {
	JobID                 string
	WorkerIndex           int
	TotalWorkers          int
	DatabaseURL           string
	KafkaBootstrapServers string
	KafkaTopicName        string
	RepositoryURL         string
	RepositoryAuthToken   string
}

// WorkerStatus tracks worker progress
type WorkerStatus struct {
	ProcessedFiles   int64
	TotalLines       int64
	SuccessCount     int64
	ErrorCount       int64
	SkippedCount     int64
	ProcessedBytes   int64
	CurrentFile      string
	CurrentLine      int64
	CurrentTimestamp string
	LastError        string
}

func main() {
	// Load configuration from environment
	config, err := loadConfig()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to load config: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Starting worker %d for job %s\n", config.WorkerIndex, config.JobID)

	// Initialize database connection
	dbpool, err := pg.NewPGPool(config.DatabaseURL)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to connect to database: %v\n", err)
		os.Exit(1)
	}
	defer dbpool.Close()

	// Initialize Kafka producer
	producer, err := initKafkaProducer(config)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to initialize Kafka producer: %v\n", err)
		updateWorkerError(dbpool, config, "Failed to initialize Kafka producer: "+err.Error())
		os.Exit(1)
	}
	defer producer.Close()

	// Initialize AWS S3 client
	awsCfg, err := awsconfig.LoadDefaultConfig(context.Background())
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to load AWS config: %v\n", err)
		updateWorkerError(dbpool, config, "Failed to load AWS config: "+err.Error())
		os.Exit(1)
	}
	s3Client := s3.NewFromConfig(awsCfg)

	// Initialize repository and fetch streams data once
	fmt.Printf("Fetching streams data from repository...\n")
	streams, err := fetchStreamsData(config.RepositoryURL, config.RepositoryAuthToken)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to fetch streams data: %v\n", err)
		updateWorkerError(dbpool, config, "Failed to fetch streams data: "+err.Error())
		os.Exit(1)
	}
	fmt.Printf("Fetched %d streams from repository\n", len(streams.GetStreams()))

	// Load files list and job config
	files, jobConfig, err := loadJobData()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to load job data: %v\n", err)
		updateWorkerError(dbpool, config, "Failed to load job data: "+err.Error())
		os.Exit(1)
	}

	// Determine which files this worker should process
	myFiles := selectWorkerFiles(files, config.WorkerIndex, config.TotalWorkers)
	if len(myFiles) == 0 {
		fmt.Printf("No files assigned to worker %d\n", config.WorkerIndex)
		updateWorkerStatus(dbpool, config, &WorkerStatus{}, "completed")
		return
	}

	fmt.Printf("Worker %d processing %d files\n", config.WorkerIndex, len(myFiles))

	// Update status to running
	updateWorkerStatus(dbpool, config, &WorkerStatus{}, "running")

	// Get retry attempts from config (default: 3)
	retryAttempts := 3
	if ra, ok := jobConfig["retry_attempts"].(float64); ok && ra > 0 {
		retryAttempts = int(ra)
	}

	// Get dry run mode from config (default: false)
	dryRun := false
	if dr, ok := jobConfig["dry_run"].(bool); ok {
		dryRun = dr
	}

	if dryRun {
		fmt.Printf("DRY RUN MODE: Messages will be processed but NOT sent to Kafka\n")
	}

	// Process assigned files
	status := &WorkerStatus{}
	for _, fileItem := range myFiles {
		fmt.Printf("Processing file: %s (retry attempts: %d, dry_run: %v)\n", fileItem.Path, retryAttempts, dryRun)

		// Try processing file with retries
		var lastErr error
		for attempt := 1; attempt <= retryAttempts; attempt++ {
			if attempt > 1 {
				fmt.Printf("Retry attempt %d/%d for file: %s\n", attempt, retryAttempts, fileItem.Path)
				// Wait a bit before retrying (exponential backoff)
				time.Sleep(time.Duration(attempt-1) * time.Second)
			}

			// Save current counts in case we need to rollback on failure
			savedTotalLines := status.TotalLines
			savedSuccessCount := status.SuccessCount
			savedErrorCount := status.ErrorCount
			savedSkippedCount := status.SkippedCount

			lastErr = processFile(fileItem, jobConfig, producer, s3Client, streams, config, status, dbpool, dryRun)
			if lastErr == nil {
				// Success - break retry loop
				break
			}

			// Failed - rollback the counts from partial processing
			// We want to retry from a clean state
			status.TotalLines = savedTotalLines
			status.SuccessCount = savedSuccessCount
			status.ErrorCount = savedErrorCount
			status.SkippedCount = savedSkippedCount

			// Log the error but continue with retry
			fmt.Fprintf(os.Stdout, "Error processing file %s (attempt %d/%d): %v\n", fileItem.Path, attempt, retryAttempts, lastErr)
		}

		// If all retries failed, record the error
		if lastErr != nil {
			fmt.Fprintf(os.Stderr, "Failed to process file %s after %d attempts: %v\n", fileItem.Path, retryAttempts, lastErr)
			status.LastError = lastErr.Error()
			status.ErrorCount++
		}

		status.ProcessedFiles++
		status.ProcessedBytes += fileItem.Size

		// Update status periodically
		updateWorkerStatus(dbpool, config, status, "running")
	}

	// Mark as completed
	updateWorkerStatus(dbpool, config, status, "completed")
	fmt.Printf("Worker %d completed processing %d files\n", config.WorkerIndex, len(myFiles))
}

func loadConfig() (*WorkerConfig, error) {
	jobID := os.Getenv("JOB_ID")
	if jobID == "" {
		return nil, fmt.Errorf("JOB_ID environment variable not set")
	}

	workerIndexStr := os.Getenv("WORKER_INDEX")
	if workerIndexStr == "" {
		return nil, fmt.Errorf("WORKER_INDEX environment variable not set")
	}

	workerIndex, err := strconv.Atoi(workerIndexStr)
	if err != nil {
		return nil, fmt.Errorf("invalid WORKER_INDEX: %w", err)
	}

	totalWorkersStr := os.Getenv("TOTAL_WORKERS")
	if totalWorkersStr == "" {
		return nil, fmt.Errorf("TOTAL_WORKERS environment variable not set")
	}

	totalWorkers, err := strconv.Atoi(totalWorkersStr)
	if err != nil {
		return nil, fmt.Errorf("invalid TOTAL_WORKERS: %w", err)
	}

	// Read infrastructure configuration from environment variables
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL environment variable is required")
	}

	kafkaBootstrapServers := os.Getenv("KAFKA_BOOTSTRAP_SERVERS")
	if kafkaBootstrapServers == "" {
		return nil, fmt.Errorf("KAFKA_BOOTSTRAP_SERVERS environment variable is required")
	}

	kafkaTopicName := os.Getenv("KAFKA_DESTINATIONS_TOPIC")
	if kafkaTopicName == "" {
		return nil, fmt.Errorf("KAFKA_DESTINATIONS_TOPIC environment variable is required")
	}

	repositoryURL := os.Getenv("REPOSITORY_URL")
	if repositoryURL == "" {
		return nil, fmt.Errorf("REPOSITORY_URL environment variable is required")
	}

	repositoryAuthToken := os.Getenv("REPOSITORY_AUTH_TOKEN")
	if repositoryAuthToken == "" {
		return nil, fmt.Errorf("REPOSITORY_AUTH_TOKEN environment variable is required")
	}

	return &WorkerConfig{
		JobID:                 jobID,
		WorkerIndex:           workerIndex,
		TotalWorkers:          totalWorkers,
		DatabaseURL:           databaseURL,
		KafkaBootstrapServers: kafkaBootstrapServers,
		KafkaTopicName:        kafkaTopicName,
		RepositoryURL:         repositoryURL,
		RepositoryAuthToken:   repositoryAuthToken,
	}, nil
}

func initKafkaProducer(config *WorkerConfig) (*kafkabase.Producer, error) {
	producerConfig := &kafka.ConfigMap{
		"bootstrap.servers":            config.KafkaBootstrapServers,
		"queue.buffering.max.messages": 200000,
		"batch.size":                   1048576,
		"linger.ms":                    1000,
		"compression.type":             "zstd",
	}

	producer, err := kafkabase.NewProducer(&kafkabase.KafkaConfig{}, producerConfig, true, nil)
	if err != nil {
		return nil, err
	}

	producer.Start()
	return producer, nil
}

func gzipDecompress(data []byte) ([]byte, error) {
	buf := bytes.NewBuffer(data)
	gz, err := gzip.NewReader(buf)
	if err != nil {
		return nil, err
	}
	defer gz.Close()

	var outBuf bytes.Buffer
	if _, err := outBuf.ReadFrom(gz); err != nil {
		return nil, err
	}
	return outBuf.Bytes(), nil
}

func loadJobData() ([]FileItem, map[string]interface{}, error) {
	// Load files list from ConfigMap
	filesDataGz, err := os.ReadFile("/config/files/files.json")
	if err != nil {
		return nil, nil, fmt.Errorf("failed to read files list: %w", err)
	}
	filesData, err := gzipDecompress(filesDataGz)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to decompress files list: %w", err)
	}

	var files []FileItem
	if err := json.Unmarshal(filesData, &files); err != nil {
		return nil, nil, fmt.Errorf("failed to parse files list: %w", err)
	}

	// Load job config from Secret
	configData, err := os.ReadFile("/config/job/config.json")
	if err != nil {
		return nil, nil, fmt.Errorf("failed to read job config: %w", err)
	}

	var jobConfig map[string]interface{}
	if err := json.Unmarshal(configData, &jobConfig); err != nil {
		return nil, nil, fmt.Errorf("failed to parse job config: %w", err)
	}

	return files, jobConfig, nil
}

func selectWorkerFiles(files []FileItem, workerIndex, totalWorkers int) []FileItem {
	fmt.Printf("Selecting files for worker %d out of %d workers (total %d files)\n", workerIndex, totalWorkers, len(files))
	var myFiles []FileItem
	for i, file := range files {
		if i%totalWorkers == workerIndex {
			myFiles = append(myFiles, file)
		}
	}
	return myFiles
}

func processFile(fileItem FileItem, jobConfig map[string]interface{}, producer *kafkabase.Producer, s3Client *s3.Client, streams *Streams, config *WorkerConfig, status *WorkerStatus, dbpool *pgxpool.Pool, dryRun bool) error {
	status.CurrentFile = fileItem.Path

	// Get file reader
	var reader io.ReadCloser
	var err error

	if strings.HasPrefix(fileItem.Path, "s3://") {
		reader, err = downloadS3File(s3Client, fileItem.Path)
		if err != nil {
			return fmt.Errorf("failed to download S3 file: %w", err)
		}
		defer reader.Close()
	} else {
		reader, err = os.Open(fileItem.Path)
		if err != nil {
			return fmt.Errorf("failed to open file: %w", err)
		}
		defer reader.Close()
	}

	// Handle gzip compression
	var fileReader io.Reader = reader
	if strings.HasSuffix(fileItem.Path, ".gz") {
		gzReader, err := gzip.NewReader(reader)
		if err != nil {
			return fmt.Errorf("failed to create gzip reader: %w", err)
		}
		defer gzReader.Close()
		fileReader = gzReader
	}

	// Process lines
	scanner := bufio.NewScanner(fileReader)
	scanner.Buffer(make([]byte, 1024*1024), 1024*1024*10)
	lineNum := int64(0)
	batchSize := 1000 // Default batch size
	if bs, ok := jobConfig["batch_size"].(float64); ok {
		batchSize = int(bs)
	}

	batch := make([]map[string]interface{}, 0, batchSize)

	for scanner.Scan() {
		lineNum++
		status.CurrentLine = lineNum
		status.TotalLines++

		line := scanner.Bytes()

		// Parse message
		var message map[string]interface{}
		if err := jsonorder.Unmarshal(line, &message); err != nil {
			fmt.Fprintf(os.Stderr, "Failed to parse line %d: %v\n", lineNum, err)
			status.ErrorCount++
			continue
		}

		// Filter message based on job config
		if !shouldProcessMessage(message, jobConfig) {
			status.SkippedCount++
			continue
		}

		batch = append(batch, message)

		if len(batch) >= batchSize {
			if err := sendBatch(batch, producer, config.KafkaTopicName, jobConfig, streams, status, dryRun); err != nil {
				fmt.Fprintf(os.Stderr, "Failed to send batch: %v\n", err)
				status.ErrorCount += int64(len(batch))
			} else {
				status.SuccessCount += int64(len(batch))
			}
			batch = batch[:0]
		}

		// Update status periodically (every 100000 lines)
		if lineNum%100000 == 0 {
			updateWorkerStatus(dbpool, config, status, "running")
		}
	}

	// Send remaining batch
	if len(batch) > 0 {
		if err := sendBatch(batch, producer, config.KafkaTopicName, jobConfig, streams, status, dryRun); err != nil {
			fmt.Fprintf(os.Stderr, "Failed to send final batch: %v\n", err)
			status.ErrorCount += int64(len(batch))
		} else {
			status.SuccessCount += int64(len(batch))
		}
	}

	return scanner.Err()
}

func downloadS3File(s3Client *s3.Client, s3Path string) (io.ReadCloser, error) {
	parts := strings.SplitN(strings.TrimPrefix(s3Path, "s3://"), "/", 2)
	if len(parts) != 2 {
		return nil, fmt.Errorf("invalid S3 path: %s", s3Path)
	}

	bucket := parts[0]
	key := parts[1]

	result, err := s3Client.GetObject(context.Background(), &s3.GetObjectInput{
		Bucket: aws.String(bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return nil, err
	}

	return result.Body, nil
}

func shouldProcessMessage(message map[string]interface{}, jobConfig map[string]interface{}) bool {
	// Apply filters from job config
	if streamIds, ok := jobConfig["stream_ids"].([]interface{}); ok && len(streamIds) > 0 {
		origin, ok := message["origin"].(*jsonorder.OrderedMap[string, interface{}])
		if !ok {
			return false
		}

		sourceId := origin.GetS("sourceId")
		slug := origin.GetS("slug")
		found := false
		for _, sid := range streamIds {
			if sid == sourceId || sid == slug {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	// Add date filtering if needed
	if dateFrom, ok := jobConfig["date_from"].(string); ok && dateFrom != "" && dateFrom != "0001-01-01T00:00:00Z" {
		messageCreated, _ := message["messageCreated"].(string)
		if messageCreated != "" {
			msgTime, err := time.Parse(time.RFC3339Nano, messageCreated)
			if err == nil {
				fromTime, err := time.Parse(time.RFC3339, dateFrom)
				if err == nil && msgTime.Before(fromTime) {
					return false
				}
			}
		}
	}

	if dateTo, ok := jobConfig["date_to"].(string); ok && dateTo != "" && dateTo != "0001-01-01T00:00:00Z" {
		messageCreated, _ := message["messageCreated"].(string)
		if messageCreated != "" {
			msgTime, err := time.Parse(time.RFC3339Nano, messageCreated)
			if err == nil {
				toTime, err := time.Parse(time.RFC3339, dateTo)
				if err == nil && msgTime.After(toTime) {
					return false
				}
			}
		}
	}
	return true
}

func sendBatch(batch []map[string]interface{}, producer *kafkabase.Producer, topic string, jobConfig map[string]interface{}, streams *Streams, status *WorkerStatus, dryRun bool) error {
	for _, message := range batch {
		// Get connection IDs from job config or repository
		connectionIds := []string{}
		if connIds, ok := jobConfig["connection_ids"].([]interface{}); ok {
			for _, id := range connIds {
				if idStr, ok := id.(string); ok {
					connectionIds = append(connectionIds, idStr)
				}
			}
		}

		// If no connection IDs provided, look them up from repository
		if len(connectionIds) == 0 && streams != nil {
			origin, _ := message["origin"].(*jsonorder.OrderedMap[string, interface{}])
			if origin != nil {
				sourceId := origin.GetS("sourceId")
				slug := origin.GetS("slug")
				streamId := sourceId
				if streamId == "" {
					streamId = slug
				}

				if streamId != "" {
					stream := streams.GetStreamByPlainKeyOrId(streamId)
					if stream == nil {
						fmt.Fprintf(os.Stderr, "Stream not found for source id: %s\n", streamId)
						status.ErrorCount++
						continue
					}
					if len(stream.AsynchronousDestinations) == 0 {
						fmt.Fprintf(os.Stderr, "No destinations found for stream: %s\n", streamId)
						status.ErrorCount++
						continue
					}
					for _, dest := range stream.AsynchronousDestinations {
						connectionIds = append(connectionIds, dest.ConnectionId)
					}
				}
			}
		}

		// Build headers
		headers := map[string]string{}
		if len(connectionIds) > 0 {
			headers["connection_ids"] = strings.Join(connectionIds, ",")
		}

		// Send message
		messageBytes, err := jsonorder.Marshal(message)
		if err != nil {
			return err
		}

		// Skip Kafka send if in dry run mode
		if dryRun {
			// In dry run mode, just validate that we can marshal the message
			// but don't actually send to Kafka
			continue
		}

		err = producer.ProduceAsync(topic, uuid.New(), messageBytes, headers, kafka.PartitionAny, "", false, 30*time.Second)
		if err != nil {
			return err
		}
	}

	return nil
}

func updateWorkerStatus(dbpool *pgxpool.Pool, config *WorkerConfig, status *WorkerStatus, statusStr string) {
	_, err := dbpool.Exec(context.Background(),
		`INSERT INTO reprocessing_workers
		 (job_id, worker_index, status, started_at, updated_at, current_file, current_line, current_ts,
		  processed_files, total_lines, success_count, error_count, skipped_count, processed_bytes, error)
		 VALUES ($1, $2, $3, NOW(), NOW(), $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
		 ON CONFLICT (job_id, worker_index)
		 DO UPDATE SET
		   status = $3,
		   updated_at = NOW(),
		   current_file = $4,
		   current_line = $5,
		   current_ts = $6,
		   processed_files = $7,
		   total_lines = $8,
		   success_count = $9,
		   error_count = $10,
		   skipped_count = $11,
		   processed_bytes = $12,
		   error = $13,
		   completed_at = CASE WHEN $3 IN ('completed', 'failed', 'cancelled') THEN NOW() ELSE reprocessing_workers.completed_at END`,
		config.JobID, config.WorkerIndex, statusStr, status.CurrentFile, status.CurrentLine, status.CurrentTimestamp,
		status.ProcessedFiles, status.TotalLines, status.SuccessCount, status.ErrorCount, status.SkippedCount,
		status.ProcessedBytes, status.LastError)

	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to update worker status: %v\n", err)
	}
}

func updateWorkerError(dbpool *pgxpool.Pool, config *WorkerConfig, errorMsg string) {
	status := &WorkerStatus{LastError: errorMsg}
	updateWorkerStatus(dbpool, config, status, "failed")
}
