package scheduling

import (
	"fmt"
	"github.com/jitsucom/jitsu/server/timestamp"
	"github.com/robfig/cron/v3"
	"sync"
)

//CronScheduler is used for scheduling TaskService.Sync() call
type CronScheduler struct {
	mutex *sync.RWMutex

	cronInstance *cron.Cron
	//sourceID_collectionID: EntryID
	scheduledEntries map[string]cron.EntryID

	executeFunc func(source, collection string, retryCount int)
}

//NewCronScheduler return CronScheduler but not started!!
//for starting scheduling run CronScheduler.Start()
func NewCronScheduler() *CronScheduler {
	scheduler := &CronScheduler{
		mutex: &sync.RWMutex{},
		cronInstance: cron.New(cron.WithParser(cron.NewParser(
			cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow | cron.Descriptor,
		))),
		scheduledEntries: map[string]cron.EntryID{},
	}

	return scheduler
}

//Start initialize executeFunc and start cron scheduler job
func (s *CronScheduler) Start(executeFunc func(source, collection string, retryCount int)) {
	s.executeFunc = executeFunc
	s.cronInstance.Start()
}

//Schedule adds source_collection pair to cron scheduler with scheduleTiming (standard cron format e.g. */5 1,2,3 * * *)
func (s *CronScheduler) Schedule(source, collection, scheduleTiming string) error {
	key := fmt.Sprintf("%s_%s", source, collection)
	s.mutex.RLock()
	entry, exist := s.scheduledEntries[key]
	s.mutex.RUnlock()

	if exist {
		entry := s.cronInstance.Entry(entry)
		return fmt.Errorf("Source and collection pair is already scheduled (next run: %s | last run: %s)", entry.Next.Format(timestamp.Layout), entry.Prev.Format(timestamp.Layout))
	}

	s.mutex.Lock()
	defer s.mutex.Unlock()

	entryID, err := s.cronInstance.AddFunc(scheduleTiming, func() { s.executeFunc(source, collection, 0) })
	if err != nil {
		return err
	}

	s.scheduledEntries[key] = entryID
	return nil
}

//Remove delete source_collection pair from cron scheduler
func (s *CronScheduler) Remove(source, collection string) error {
	key := fmt.Sprintf("%s_%s", source, collection)
	s.mutex.RLock()
	entry, exist := s.scheduledEntries[key]
	s.mutex.RUnlock()

	if !exist {
		return nil
	}

	s.mutex.Lock()
	defer s.mutex.Unlock()

	s.cronInstance.Remove(entry)
	delete(s.scheduledEntries, key)

	return nil
}

func (s *CronScheduler) Close() error {
	s.cronInstance.Stop()

	return nil
}
