package main

import (
	"context"
	"crypto/tls"
	"database/sql"
	"fmt"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/confluentinc/confluent-kafka-go/v2/kafka"
	"github.com/jitsucom/bulker/jitsubase/appbase"
	"github.com/jitsucom/bulker/jitsubase/utils"
	"github.com/jitsucom/bulker/jitsubase/uuid"
	"github.com/jitsucom/bulker/kafkabase"
)

// DeadLetterRecord represents a row from newjitsu_metrics.dead_letter table
type DeadLetterRecord struct {
	Timestamp   time.Time `json:"timestamp"`
	WorkspaceId string    `json:"workspaceId"`
	ActorId     string    `json:"actorId"`
	Type        string    `json:"type"`
	Payload     string    `json:"payload"`
	Error       string    `json:"error"`
}

// DeadLetterReprocessorConfig contains configuration for dead letter reprocessing
type DeadLetterReprocessorConfig struct {
	WorkspaceId string    `json:"workspace_id,omitempty"`
	ActorId     string    `json:"actor_id,omitempty"`
	Type        string    `json:"type,omitempty"`
	DateFrom    time.Time `json:"date_from,omitempty"`
	DateTo      time.Time `json:"date_to,omitempty"`
	Limit       int       `json:"limit,omitempty"`
	DryRun      bool      `json:"dry_run"`
	TargetTopic string    `json:"target_topic"`
}

// DeadLetterReprocessorResult contains the result of reprocessing
type DeadLetterReprocessorResult struct {
	TotalRecords   int64  `json:"total_records"`
	ProcessedCount int64  `json:"processed_count"`
	ErrorCount     int64  `json:"error_count"`
	LastError      string `json:"last_error,omitempty"`
}

// DeadLetterReprocessor handles reprocessing of dead letter records from ClickHouse to Kafka
type DeadLetterReprocessor struct {
	appbase.Service
	chConn   *sql.DB
	producer *kafkabase.Producer
	config   *Config
}

// NewDeadLetterReprocessor creates a new dead letter reprocessor
func NewDeadLetterReprocessor(config *Config) (*DeadLetterReprocessor, error) {
	base := appbase.NewServiceBase("deadletter-reprocessor")

	// Parse ClickHouse configuration from URL and env vars
	chConfig, err := utils.GetClickhouseConfig(config)
	if err != nil {
		return nil, fmt.Errorf("failed to parse clickhouse config: %w", err)
	}

	if chConfig.Host == "" {
		return nil, fmt.Errorf("CLICKHOUSE_URL or CLICKHOUSE_HOST is required for dead letter reprocessor")
	}

	// Initialize ClickHouse connection
	opts := &clickhouse.Options{
		Addr: []string{chConfig.GetAddr()},
		Auth: clickhouse.Auth{
			Database: chConfig.Database,
			Username: chConfig.Username,
			Password: chConfig.Password,
		},
		Settings: clickhouse.Settings{
			"date_time_input_format": "best_effort",
		},
		Compression: &clickhouse.Compression{
			Method: clickhouse.CompressionLZ4,
		},
		Protocol:    clickhouse.HTTP,
		DialTimeout: time.Second * 10,
	}
	if chConfig.SSL {
		opts.TLS = &tls.Config{
			InsecureSkipVerify: true,
		}
	}
	chConn := clickhouse.OpenDB(opts)

	// Test connection
	if err := chConn.Ping(); err != nil {
		return nil, fmt.Errorf("failed to connect to ClickHouse: %w", err)
	}

	// Initialize Kafka producer
	kafkaConfig := config.KafkaConfig.GetKafkaConfig()
	_ = kafkaConfig.SetKey("queue.buffering.max.messages", config.ProducerQueueSize)
	_ = kafkaConfig.SetKey("batch.size", config.ProducerBatchSize)
	_ = kafkaConfig.SetKey("linger.ms", config.ProducerLingerMs)
	//compression
	if config.KafkaTopicCompression != "" {
		_ = kafkaConfig.SetKey("compression.type", config.KafkaTopicCompression)
	}

	producer, err := kafkabase.NewProducer(&config.KafkaConfig, kafkaConfig, false, nil)
	if err != nil {
		chConn.Close()
		return nil, fmt.Errorf("failed to create Kafka producer: %w", err)
	}
	producer.Start()

	return &DeadLetterReprocessor{
		Service:  base,
		chConn:   chConn,
		producer: producer,
		config:   config,
	}, nil
}

// CountRecords returns the number of records matching the filter
func (r *DeadLetterReprocessor) CountRecords(ctx context.Context, cfg DeadLetterReprocessorConfig) (int64, error) {
	query, args := r.buildQuery(cfg, true)
	var count int64
	err := r.chConn.QueryRowContext(ctx, query, args...).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("failed to count records: %w", err)
	}
	return count, nil
}

// Reprocess reads dead letter records from ClickHouse and produces them to Kafka
func (r *DeadLetterReprocessor) Reprocess(ctx context.Context, cfg DeadLetterReprocessorConfig) (*DeadLetterReprocessorResult, error) {
	if cfg.TargetTopic == "" {
		return nil, fmt.Errorf("target_topic is required")
	}

	result := &DeadLetterReprocessorResult{}

	// Count total records first
	count, err := r.CountRecords(ctx, cfg)
	if err != nil {
		return nil, err
	}
	result.TotalRecords = count

	if count == 0 {
		r.Infof("No dead letter records found matching the filter")
		return result, nil
	}

	r.Infof("Found %d dead letter records to reprocess", count)

	if cfg.DryRun {
		r.Infof("Dry run mode - not producing to Kafka")
		return result, nil
	}

	// Query records
	query, args := r.buildQuery(cfg, false)
	rows, err := r.chConn.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to query dead letter records: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		select {
		case <-ctx.Done():
			result.LastError = "context cancelled"
			return result, ctx.Err()
		default:
		}

		var record DeadLetterRecord
		if err := rows.Scan(&record.Timestamp, &record.WorkspaceId, &record.ActorId, &record.Type, &record.Payload, &record.Error); err != nil {
			result.ErrorCount++
			result.LastError = fmt.Sprintf("failed to scan row: %v", err)
			r.Errorf("Failed to scan row: %v", err)
			continue
		}
		key := uuid.New()

		// Produce payload to Kafka
		err := r.producer.ProduceAsync(
			cfg.TargetTopic,
			key,
			[]byte(record.Payload),
			map[string]string{
				"connection_ids": record.ActorId,
			},
			kafka.PartitionAny,
			fmt.Sprintf("dl-%s-%d", record.ActorId, record.Timestamp.UnixNano()),
			false,
			30*time.Second,
		)
		if err != nil {
			result.ErrorCount++
			result.LastError = fmt.Sprintf("failed to produce message: %v", err)
			r.Errorf("Failed to produce message for actor %s: %v", record.ActorId, err)
			continue
		} else {
			r.Infof("Produced dead letter record for actor %s to topic %s key: %s", record.ActorId, cfg.TargetTopic, key)
		}
		result.ProcessedCount++

		if result.ProcessedCount%1000 == 0 {
			r.Infof("Processed %d/%d records", result.ProcessedCount, result.TotalRecords)
		}
	}

	if err := rows.Err(); err != nil {
		result.LastError = fmt.Sprintf("error iterating rows: %v", err)
		return result, err
	}

	r.Infof("Reprocessing complete: %d processed, %d errors", result.ProcessedCount, result.ErrorCount)
	return result, nil
}

// buildQuery builds the SQL query for dead letter records
func (r *DeadLetterReprocessor) buildQuery(cfg DeadLetterReprocessorConfig, countOnly bool) (string, []interface{}) {
	var selectClause string
	if countOnly {
		selectClause = "SELECT count(*)"
	} else {
		selectClause = "SELECT timestamp, workspaceId, actorId, type, payload, error"
	}

	query := fmt.Sprintf("%s FROM newjitsu_metrics.dead_letter WHERE 1=1", selectClause)
	args := []interface{}{}

	if cfg.WorkspaceId != "" {
		query += " AND workspaceId = ?"
		args = append(args, cfg.WorkspaceId)
	}

	if cfg.ActorId != "" {
		query += " AND actorId = ?"
		args = append(args, cfg.ActorId)
	}

	if cfg.Type != "" {
		query += " AND type = ?"
		args = append(args, cfg.Type)
	}

	if !cfg.DateFrom.IsZero() {
		query += " AND timestamp >= ?"
		args = append(args, cfg.DateFrom)
	}

	if !cfg.DateTo.IsZero() {
		query += " AND timestamp <= ?"
		args = append(args, cfg.DateTo)
	}

	if !countOnly {
		query += " ORDER BY timestamp ASC"
		if cfg.Limit > 0 {
			query += fmt.Sprintf(" LIMIT %d", cfg.Limit)
		}
	}

	return query, args
}

// Close shuts down the reprocessor
func (r *DeadLetterReprocessor) Close() error {
	r.Infof("Shutting down dead letter reprocessor")

	if r.producer != nil {
		r.producer.Close()
	}

	if r.chConn != nil {
		r.chConn.Close()
	}

	return nil
}
