package meta

import "time"

type Dummy struct {
}

func (d *Dummy) GetSignature(sourceID, collection, interval string) (string, error)   { return "", nil }
func (d *Dummy) SaveSignature(sourceID, collection, interval, signature string) error { return nil }
func (d *Dummy) DeleteSignature(sourceID, collection string) error                    { return nil }

func (d *Dummy) SuccessEvents(id, namespace string, now time.Time, value int) error { return nil }
func (d *Dummy) ErrorEvents(id, namespace string, now time.Time, value int) error   { return nil }
func (d *Dummy) SkipEvents(id, namespace string, now time.Time, value int) error    { return nil }
func (d *Dummy) GetProjectSourceIDs(projectID string) ([]string, error)             { return []string{}, nil }
func (d *Dummy) GetProjectPushSourceIDs(projectID string) ([]string, error)         { return []string{}, nil }
func (d *Dummy) GetProjectDestinationIDs(projectID string) ([]string, error)        { return []string{}, nil }
func (d *Dummy) GetEventsWithGranularity(namespace, status string, ids []string, start, end time.Time, granularity Granularity) ([]EventsPerTime, error) {
	return nil, nil
}

func (d *Dummy) AddEvent(destinationID, eventID, payload string, now time.Time) (int, error) {
	return 0, nil
}
func (d *Dummy) UpdateSucceedEvent(destinationID, eventID, success string) error { return nil }
func (d *Dummy) UpdateErrorEvent(destinationID, eventID, error string) error     { return nil }
func (d *Dummy) RemoveLastEvent(destinationID string) error                      { return nil }

func (d *Dummy) GetEvents(destinationID string, start, end time.Time, n int) ([]Event, error) {
	return []Event{}, nil
}
func (d *Dummy) GetTotalEvents(destinationID string) (int, error) { return 0, nil }

func (d *Dummy) SaveAnonymousEvent(destinationID, anonymousID, eventID, payload string) error {
	return nil
}
func (d *Dummy) GetAnonymousEvents(destinationID, anonymousID string) (map[string]string, error) {
	return map[string]string{}, nil
}
func (d *Dummy) DeleteAnonymousEvent(destinationID, anonymousID, eventID string) error { return nil }

func (d *Dummy) CreateTask(sourceID, collection string, task *Task, createdAt time.Time) error {
	return nil
}
func (d *Dummy) UpsertTask(task *Task) error { return nil }
func (d *Dummy) GetAllTasks(sourceID, collection string, from, to time.Time, limit int) ([]Task, error) {
	return nil, nil
}
func (d *Dummy) GetAllTaskIDs(sourceID, collection string, descendingOrder bool) ([]string, error) {
	return nil, nil
}
func (d *Dummy) GetLastTask(sourceID, collection string) (*Task, error) { return nil, nil }
func (d *Dummy) GetTask(taskID string) (*Task, error)                   { return nil, nil }
func (d *Dummy) RemoveTasks(sourceID, collection string, taskIDs ...string) (int, error) {
	return 0, nil
}
func (d *Dummy) AppendTaskLog(taskID string, now time.Time, system, message, level string) error {
	return nil
}
func (d *Dummy) GetTaskLogs(taskID string, from, to time.Time) ([]TaskLogRecord, error) {
	return nil, nil
}

//task queue
func (d *Dummy) PushTask(task *Task) error { return nil }
func (d *Dummy) PollTask() (*Task, error)  { return nil, nil }

func (d *Dummy) Type() string {
	return DummyType
}

func (d *Dummy) Close() error {
	return nil
}
