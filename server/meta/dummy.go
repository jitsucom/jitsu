package meta

import "time"

type Dummy struct {
}

func (d *Dummy) GetSignature(sourceID, collection, interval string) (string, error)   { return "", nil }
func (d *Dummy) SaveSignature(sourceID, collection, interval, signature string) error { return nil }
func (d *Dummy) DeleteSignature(sourceID, collection string) error                    { return nil }

func (d *Dummy) IncrementEventsCount(id, namespace, eventType, status string, now time.Time, value int64) error {
	return nil
}
func (d *Dummy) GetProjectSourceIDs(projectID string) ([]string, error)      { return []string{}, nil }
func (d *Dummy) GetProjectPushSourceIDs(projectID string) ([]string, error)  { return []string{}, nil }
func (d *Dummy) GetProjectDestinationIDs(projectID string) ([]string, error) { return []string{}, nil }
func (d *Dummy) GetEventsWithGranularity(namespace, status, eventType string, ids []string, start, end time.Time, granularity Granularity) ([]EventsPerTime, error) {
	return nil, nil
}

func (d *Dummy) AddEvent(namespace, id, status string, entity *Event) error  { return nil }
func (d *Dummy) TrimEvents(namespace, id, status string, capacity int) error { return nil }
func (d *Dummy) GetEvents(namespace, id, status string, limit int) ([]Event, error) {
	return []Event{}, nil
}
func (d *Dummy) GetTotalEvents(namespace, id, status string) (int, error) { return 0, nil }

func (d *Dummy) CreateTask(sourceID, collection string, task *Task, createdAt time.Time) error {
	return nil
}
func (d *Dummy) GetAllTasks(sourceID, collection string, from, to time.Time, limit int) ([]Task, error) {
	return nil, nil
}
func (d *Dummy) GetAllTaskIDs(sourceID, collection string, descendingOrder bool) ([]string, error) {
	return nil, nil
}
func (d *Dummy) GetLastTask(sourceID, collection string, offset int) (*Task, error) { return nil, nil }
func (d *Dummy) GetTask(taskID string) (*Task, error)                               { return nil, nil }
func (d *Dummy) RemoveTasks(sourceID, collection string, taskIDs ...string) (int, error) {
	return 0, nil
}
func (d *Dummy) UpdateStartedTask(taskID, status string) error    { return nil }
func (d *Dummy) UpdateFinishedTask(taskID, status string) error   { return nil }
func (d *Dummy) TaskHeartBeat(taskID string) error                { return nil }
func (d *Dummy) RemoveTaskFromHeartBeat(taskID string) error      { return nil }
func (d *Dummy) GetAllTasksHeartBeat() (map[string]string, error) { return map[string]string{}, nil }
func (d *Dummy) GetAllTasksForInitialHeartbeat(runningStatus, scheduledStatus string, lastActivityThreshold time.Duration) ([]string, error) {
	return nil, nil
}

func (d *Dummy) AppendTaskLog(taskID string, now time.Time, system, message, level string) error {
	return nil
}
func (d *Dummy) GetTaskLogs(taskID string, from, to time.Time) ([]TaskLogRecord, error) {
	return nil, nil
}

// task queue
func (d *Dummy) PushTask(task *Task) error { return nil }
func (d *Dummy) PollTask() (*Task, error)  { return nil, nil }

func (d *Dummy) GetOrCreateClusterID(generatedClusterID string) string { return generatedClusterID }

func (d *Dummy) Type() string {
	return DummyType
}

func (d *Dummy) Close() error {
	return nil
}
