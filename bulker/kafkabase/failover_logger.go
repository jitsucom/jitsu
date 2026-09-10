package kafkabase

import (
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/confluentinc/confluent-kafka-go/v2/kafka"
	"github.com/jitsucom/bulker/jitsubase/appbase"
	"github.com/jitsucom/bulker/jitsubase/compression"
	"github.com/jitsucom/bulker/jitsubase/safego"
	"github.com/jitsucom/bulker/jitsubase/utils"
	"github.com/klauspost/compress/zstd"
)

// FailoverDestination represents where to store rotated logs
type FailoverDestination interface {
	Store(filePath string) error
	Name() string
}

// LocalFileDestination stores files locally
type LocalFileDestination struct {
	basePath       string
	maxOldFiles    int
	keepCompressed bool
}

func NewLocalFileDestination(basePath string, maxOldFiles int, keepCompressed bool) *LocalFileDestination {
	return &LocalFileDestination{
		basePath:       basePath,
		maxOldFiles:    maxOldFiles,
		keepCompressed: keepCompressed,
	}
}

func (l *LocalFileDestination) Store(filePath string) error {
	filename := strings.Replace(filepath.Base(filePath), ".rotating", "", 1)
	fullPath := filepath.Join(l.basePath, filename)

	if err := os.MkdirAll(filepath.Dir(fullPath), 0755); err != nil {
		return fmt.Errorf("failed to create directory: %w", err)
	}

	// Move file to destination path
	if err := os.Rename(filePath, fullPath); err != nil {
		return fmt.Errorf("failed to move file: %w", err)
	}

	// Clean up old files if needed
	if l.maxOldFiles > 0 {
		if err := l.cleanupOldFiles(); err != nil {
			return fmt.Errorf("failed to cleanup old files: %w", err)
		}
	}

	return nil
}

func (l *LocalFileDestination) cleanupOldFiles() error {
	// Every form we may have written, uncompressed and each compression suffix.
	// Enumerated from the shared list rather than by hand: a suffix missing here
	// means those files are never cleaned up, and local disk grows without bound.
	patterns := compression.Globs(l.basePath, "*.ndjson")

	var allFiles []string
	for _, pattern := range patterns {
		files, err := filepath.Glob(pattern)
		if err != nil {
			continue
		}
		allFiles = append(allFiles, files...)
	}

	if len(allFiles) <= l.maxOldFiles {
		return nil
	}

	// Sort files by modification time
	type fileInfo struct {
		path    string
		modTime time.Time
	}

	var fileInfos []fileInfo
	for _, file := range allFiles {
		info, err := os.Stat(file)
		if err != nil {
			continue
		}
		fileInfos = append(fileInfos, fileInfo{
			path:    file,
			modTime: info.ModTime(),
		})
	}

	sort.Slice(fileInfos, func(i, j int) bool {
		return fileInfos[i].modTime.Before(fileInfos[j].modTime)
	})

	// Remove oldest files
	filesToRemove := len(fileInfos) - l.maxOldFiles
	for i := 0; i < filesToRemove; i++ {
		os.Remove(fileInfos[i].path)
	}

	return nil
}

func (l *LocalFileDestination) Name() string {
	return "local"
}

// S3Destination stores files in S3
type S3Destination struct {
	client *s3.Client
	bucket string
	prefix string
}

func NewS3Destination(bucket, prefix string, awsConfig aws.Config) (*S3Destination, error) {
	client := s3.NewFromConfig(awsConfig)
	return &S3Destination{
		client: client,
		bucket: bucket,
		prefix: prefix,
	}, nil
}

func (s *S3Destination) Store(filePath string) error {
	filename := strings.Replace(filepath.Base(filePath), ".rotating", "", 1)
	key := utils.JoinNonEmptyStrings("_", s.prefix, filename)

	// Open file for streaming
	file, err := os.Open(filePath)
	if err != nil {
		return fmt.Errorf("failed to open file: %w", err)
	}
	defer file.Close()

	_, err = s.client.PutObject(context.Background(), &s3.PutObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
		Body:   file,
	})
	if err != nil {
		return fmt.Errorf("failed to upload to S3: %w", err)
	}
	return nil
}

func (s *S3Destination) Name() string {
	return "s3"
}

// FailoverLoggerConfig configuration for failover logger
type FailoverLoggerConfig struct {
	Enabled          bool
	LogAllMessages   bool // Log all delivery reports, not just errors
	BasePath         string
	RotationPeriod   time.Duration
	MaxSize          int64 // Max size in bytes
	Destinations     []FailoverDestination
	CompressOnRotate bool
	// "gzip" (default) or "zstd". Anything else falls back to gzip.
	CompressionCodec string
}

// FailoverLogger handles failed Kafka messages
type FailoverLogger struct {
	appbase.Service
	config       *FailoverLoggerConfig
	currentFile  *os.File
	currentSize  int64
	lastRotation time.Time
	mu           sync.Mutex
	closed       bool
	rotationChan chan struct{}
	rotationWG   sync.WaitGroup // Track async rotation tasks
}

func NewFailoverLogger(config *FailoverLoggerConfig) (*FailoverLogger, error) {
	if !config.Enabled {
		return nil, nil
	}

	base := appbase.NewServiceBase("failover-logger")

	// Ensure base path exists
	if err := os.MkdirAll(config.BasePath, 0755); err != nil {
		return nil, fmt.Errorf("failed to create base path: %w", err)
	}

	// Add local destination if none specified
	if len(config.Destinations) == 0 {
		config.Destinations = []FailoverDestination{
			NewLocalFileDestination(config.BasePath, 10, config.CompressOnRotate),
		}
	}

	logger := &FailoverLogger{
		Service:      base,
		config:       config,
		lastRotation: time.Now(),
		rotationChan: make(chan struct{}, 1),
	}

	if err := logger.openNewFile(); err != nil {
		return nil, err
	}

	return logger, nil
}

func (f *FailoverLogger) Start() {
	// Start rotation checker
	safego.RunWithRestart(func() {
		ticker := time.NewTicker(time.Second * 10)
		defer ticker.Stop()

		for {
			select {
			case <-ticker.C:
				f.mu.Lock()
				if f.shouldRotate() {
					f.mu.Unlock()
					select {
					case f.rotationChan <- struct{}{}:
					default:
					}
				} else {
					f.mu.Unlock()
				}
			case <-f.rotationChan:
				if err := f.rotate(); err != nil {
					f.Errorf("Failed to rotate log: %v", err)
				}
			}
		}
	})
}

func (f *FailoverLogger) ShouldLog(err error) bool {
	if f == nil || !f.config.Enabled {
		return false
	}

	// Always log if LogAllMessages is enabled
	if f.config.LogAllMessages {
		return true
	}

	// Only log messages with errors
	if err == nil {
		return false
	}

	// Check if it's a KafkaError
	if kafkaErr, ok := err.(kafka.Error); ok {
		// Ignore "Message size too large" error
		if kafkaErr.Code() == kafka.ErrMsgSizeTooLarge {
			return false
		}
	}

	// If it's not a KafkaError, log it
	return true
}

func (f *FailoverLogger) LogPayload(payload []byte) error {
	if f == nil || f.closed {
		return nil
	}

	f.mu.Lock()
	defer f.mu.Unlock()

	// Write raw payload to file
	if _, err := f.currentFile.Write(payload); err != nil {
		return fmt.Errorf("failed to write to failover log: %w", err)
	}
	if _, err := f.currentFile.Write([]byte("\n")); err != nil {
		return fmt.Errorf("failed to write newline: %w", err)
	}

	f.currentSize += int64(len(payload) + 1)

	// Check if rotation needed
	if f.shouldRotate() {
		select {
		case f.rotationChan <- struct{}{}:
		default:
		}
	}

	return nil
}

func (f *FailoverLogger) shouldRotate() bool {
	if f.config.MaxSize > 0 && f.currentSize >= f.config.MaxSize {
		return true
	}

	if f.config.RotationPeriod > 0 && time.Since(f.lastRotation) >= f.config.RotationPeriod {
		return true
	}

	return false
}

func (f *FailoverLogger) rotate() error {
	// Rotate the file synchronously
	rotatedPath, err := f.rotateFile()
	if err != nil {
		return err
	}

	if rotatedPath == "" {
		// No file to rotate
		return nil
	}

	// Process rotation asynchronously
	f.rotationWG.Add(1)
	safego.RunWithRestart(func() {
		defer f.rotationWG.Done()
		f.processRotatedFile(rotatedPath)
	})

	return nil
}

func (f *FailoverLogger) rotateFile() (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	if f.currentFile == nil {
		return "", nil
	}

	if f.currentSize == 0 {
		return "", nil // No data to rotate
	}

	// Close current file
	if err := f.currentFile.Close(); err != nil {
		return "", fmt.Errorf("failed to close current file: %w", err)
	}

	currentPath := f.currentFile.Name()

	// Rename file from .tmp to .rotating to mark it as ready for processing
	rotatedPath := strings.TrimSuffix(currentPath, ".tmp") + ".rotating"
	if err := os.Rename(currentPath, rotatedPath); err != nil {
		return "", fmt.Errorf("failed to rename file for rotation: %w", err)
	}

	// Open new file immediately
	if err := f.openNewFile(); err != nil {
		// Try to rename back on failure
		_ = os.Rename(rotatedPath, currentPath)
		return "", fmt.Errorf("failed to open new file: %w", err)
	}

	return rotatedPath, nil
}

func (f *FailoverLogger) processRotatedFile(rotatedPath string) {
	f.Infof("Rotating failover log file: " + rotatedPath)
	// Compress if needed
	finalPath := rotatedPath
	if f.config.CompressOnRotate {
		compressedPath := rotatedPath + f.compressionSuffix()
		if err := f.compressFile(rotatedPath, compressedPath); err != nil {
			f.Errorf("Failed to compress file: %v", err)
			return
		}
		finalPath = compressedPath
		// Remove uncompressed file
		_ = os.Remove(rotatedPath)
	}

	// Store to destinations (LocalFileDestination should be last as it moves the file)
	for _, dest := range f.config.Destinations {
		if err := dest.Store(finalPath); err != nil {
			f.Errorf("Failed to store to %s: %v", dest.Name(), err)
		}
	}
}

// compressionSuffix is the suffix for the configured codec. It must agree with
// compressFile: a file compressed with one codec and named for another is not
// merely mislabelled, it is invisible to the discovery filters in admin and to
// cleanup here.
func (f *FailoverLogger) compressionSuffix() string {
	if f.config.CompressionCodec == codecZstd {
		return compression.SuffixZstd
	}
	return compression.SuffixGzip
}

const codecZstd = "zstd"

func (f *FailoverLogger) compressFile(src, dst string) error {
	srcFile, err := os.Open(src)
	if err != nil {
		return err
	}
	defer srcFile.Close()

	dstFile, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer dstFile.Close()

	var writer io.WriteCloser
	if f.config.CompressionCodec == codecZstd {
		// SpeedDefault: failover files are write-once-read-once and then deleted.
		enc, err := zstd.NewWriter(dstFile,
			zstd.WithEncoderLevel(zstd.SpeedDefault),
			zstd.WithEncoderConcurrency(1))
		if err != nil {
			return err
		}
		writer = enc
	} else {
		writer = gzip.NewWriter(dstFile)
	}

	if _, err := io.Copy(writer, srcFile); err != nil {
		_ = writer.Close()
		return err
	}

	return writer.Close()
}

func (f *FailoverLogger) openNewFile() error {
	timestamp := time.Now().UTC().Format("2006_01_02T15_04_05")
	filename := fmt.Sprintf("kafka_failover_%s.ndjson.tmp", timestamp)
	filepath := filepath.Join(f.config.BasePath, filename)

	file, err := os.OpenFile(filepath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return fmt.Errorf("failed to open new file: %w", err)
	}

	f.currentFile = file
	f.currentSize = 0
	f.lastRotation = time.Now()

	return nil
}

func (f *FailoverLogger) Close() error {
	f.mu.Lock()
	f.closed = true
	currentFile := f.currentFile
	currentSize := f.currentSize
	f.mu.Unlock()

	if currentFile != nil {
		// Perform final rotation
		if currentSize > 0 {
			if err := f.rotate(); err != nil {
				f.Errorf("Failed to rotate on close: %v", err)
			}
		} else {
			currentFile.Close()
			// Remove empty file
			os.Remove(currentFile.Name())
		}
	}

	// Wait for all async rotations to complete
	f.rotationWG.Wait()

	return nil
}
