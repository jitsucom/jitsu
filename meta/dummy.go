package meta

import "time"

type Dummy struct {
}

func (d *Dummy) GetSignature(sourceId, collection, interval string) (string, error)   { return "", nil }
func (d *Dummy) SaveSignature(sourceId, collection, interval, signature string) error { return nil }

func (d *Dummy) SuccessEvents(id, namespace string, now time.Time, value int) error { return nil }
func (d *Dummy) ErrorEvents(id, namespace string, now time.Time, value int) error   { return nil }
func (d *Dummy) SkipEvents(id, namespace string, now time.Time, value int) error    { return nil }

func (d *Dummy) AddEvent(destinationId, eventId, payload string, now time.Time) (int, error) {
	return 0, nil
}
func (d *Dummy) UpdateSucceedEvent(destinationId, eventId, success string) error { return nil }
func (d *Dummy) UpdateErrorEvent(destinationId, eventId, error string) error     { return nil }
func (d *Dummy) RemoveLastEvent(destinationId string) error                      { return nil }

func (d *Dummy) GetEvents(destinationId string, start, end time.Time, n int) ([]Event, error) {
	return []Event{}, nil
}
func (d *Dummy) GetTotalEvents(destinationId string) (int, error) { return 0, nil }

func (d *Dummy) SaveAnonymousEvent(destinationId, anonymousId, eventId, payload string) error {
	return nil
}
func (d *Dummy) GetAnonymousEvents(destinationId, anonymousId string) (map[string]string, error) {
	return map[string]string{}, nil
}
func (d *Dummy) DeleteAnonymousEvent(destinationId, anonymousId, eventId string) error { return nil }

func (d *Dummy) CreateTask(sourceId, collection string, task *Task, createdAt time.Time) error {
	return nil
}
func (d *Dummy) UpsertTask(task *Task) error { return nil }
func (d *Dummy) GetAllTasks(sourceId, collection string, from, to time.Time) ([]Task, error) {
	return nil, nil
}
func (d *Dummy) GetLastTask(sourceId, collection string) (*Task, error) { return nil, nil }
func (d *Dummy) GetTask(taskId string) (*Task, error)                   { return nil, nil }

func (d *Dummy) AppendTaskLog(taskId string, now time.Time, message, level string) error { return nil }
func (d *Dummy) GetTaskLogs(taskId string, from, to time.Time) ([]TaskLogRecord, error) {
	return nil, nil
}

//task queue
func (d *Dummy) PushTask(task *Task) error { return nil }
func (d *Dummy) PollTask() (*Task, error)  { return nil, nil }
func (d *Dummy) IsTaskInQueue(sourceId, collection string) (string, bool, error) {
	return "", false, nil
}

func (d *Dummy) Type() string {
	return DummyType
}

func (d *Dummy) Close() error {
	return nil
}
