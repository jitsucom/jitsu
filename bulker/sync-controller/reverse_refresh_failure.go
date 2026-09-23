package main

import (
	"context"
	"encoding/json"
	"math"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jitsucom/bulker/jitsubase/uuid"
)

// Record startup/worker failures on the existing logical task. The deterministic
// worker name fences late notifications, including Pods that never reached Node.
func (t *TaskManager) recordReverseRefreshFailure(ctx context.Context, syncID, taskID, workerID, message string, allowActive bool, staleBefore ...time.Time) error {
	tx, err := t.dbpool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var status string
	var raw []byte
	var updatedAt time.Time
	err = tx.QueryRow(ctx, `SELECT status,metrics,updated_at FROM source_task
 WHERE sync_id=$1 AND task_id=$2 AND package='jitsu/retl-runner'
 AND status IN ('PENDING','WAITING') FOR UPDATE`, syncID, taskID).Scan(&status, &raw, &updatedAt)
	if err == pgx.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}
	if len(staleBefore) > 0 && !updatedAt.Before(staleBefore[0]) {
		return nil
	}
	var metrics map[string]any
	if err = json.Unmarshal(raw, &metrics); err != nil {
		return err
	}
	schedule, ok := metrics["reverseRecovery"].(map[string]any)
	if !ok {
		return nil
	}
	worker, _ := metrics["reverseWorker"].(map[string]any)
	active, _ := worker["active"].(bool)
	previousWorker, _ := worker["id"].(string)
	attempt, _ := schedule["attempt"].(float64)
	expected := reverseResourceName(syncID + ":refresh:" + taskID + ":" + strconv.Itoa(int(attempt)))
	if active {
		if !allowActive || previousWorker != workerID {
			return nil
		}
	} else if previousWorker == workerID || expected != workerID {
		return nil // Already finished, or superseded before it could start.
	}
	if original, ok := schedule["previousStatus"].(string); ok {
		status = original
	}
	if active {
		if original, ok := worker["previousStatus"].(string); ok {
			status = original
		}
	}
	if status != "PENDING" && status != "WAITING" && status != "FAILED" && status != "CANCELLED" {
		return nil
	}
	now := time.Now().UTC()
	if attempt >= math.MaxInt32 {
		schedule["suspended"] = true
	} else {
		attempt++
	}
	delay := time.Duration(math.Min(60, 30*math.Pow(1.3, attempt)) * float64(time.Minute))
	next := now.Add(delay)
	if deadlineText, ok := schedule["deadline"].(string); ok {
		if deadline, err := time.Parse(time.RFC3339Nano, deadlineText); err == nil {
			if !now.Before(deadline) {
				schedule["suspended"] = true
			} else if next.After(deadline) {
				next = deadline
			}
		}
	}
	schedule["attempt"], schedule["nextCheckAt"] = int(attempt), next.Format(time.RFC3339Nano)
	delete(schedule, "previousStatus")
	metrics["reverseWorker"] = map[string]any{"id": workerID, "active": false}
	raw, err = json.Marshal(metrics)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `UPDATE source_task SET status=$3,metrics=$4,updated_at=clock_timestamp()
 WHERE sync_id=$1 AND task_id=$2`, syncID, taskID, status, raw)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO task_log(id,level,logger,message,sync_id,task_id)
 VALUES($1,'ERROR','retl-runner',$2,$3,$4)`, uuid.New(), message, syncID, taskID)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}
