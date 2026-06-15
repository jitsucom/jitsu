package app

import (
	"math/rand/v2"
	"time"

	"github.com/go-co-op/gocron/v2"
	bulker "github.com/jitsucom/bulker/bulkerlib"
	"github.com/jitsucom/bulker/jitsubase/appbase"
	"github.com/jitsucom/bulker/jitsubase/utils"
)

type Cron struct {
	appbase.Service
	config    *Config
	scheduler gocron.Scheduler
}

func NewCron(config *Config) *Cron {
	base := appbase.NewServiceBase("cron")
	s, _ := gocron.NewScheduler(gocron.WithLocation(time.UTC))
	s.Start()
	return &Cron{Service: base, scheduler: s, config: config}
}

func (c *Cron) AddBatchConsumer(destinationId string, batchConsumer BatchConsumer) (gocron.Job, error) {
	options := []gocron.JobOption{gocron.WithTags(batchConsumer.TopicId())}
	batchPeriodSec := batchConsumer.BatchPeriodSec()
	if batchPeriodSec > 1 {
		var delay uint32
		spreadTablesSchedule := bulker.SpreadTablesSchedule.Get(batchConsumer.Options())
		// spread start time to avoid all batch run at the same time
		if batchConsumer.Mode() == "retry" {
			// random delay
			delay = rand.Uint32N(uint32(batchPeriodSec))
		} else if spreadTablesSchedule {
			// all topics(topics) for the same destination will spread across the batch period
			delay = utils.HashStringInt(batchConsumer.TopicId()) % uint32(batchPeriodSec)
		} else {
			// all topics(topics) for the same destination processing about the same time
			delay = utils.HashStringInt(destinationId) % uint32(batchPeriodSec)
			// introduce small fluctuation to avoid all batches starting exactly at the same time for multi table destinations
			delay += utils.HashStringInt(batchConsumer.TopicId()) % 30
		}
		startTime := time.Now().Truncate(time.Duration(batchPeriodSec) * time.Second).Add(time.Duration(delay) * time.Second)
		if startTime.Sub(time.Now().UTC()) < 5*time.Second {
			// we are too late to run at this time. add batchPeriodSec to start time
			startTime = startTime.Add(time.Duration(batchPeriodSec) * time.Second)
		}
		options = append(options, gocron.WithStartAt(gocron.WithStartDateTime(startTime)))
	}
	return c.scheduler.NewJob(gocron.DurationJob(time.Duration(batchPeriodSec)*time.Second),
		gocron.NewTask(batchConsumer.RunJob),
		options...)
}

func (c *Cron) ReplaceBatchConsumer(destinationId string, batchConsumer BatchConsumer) (gocron.Job, error) {
	c.RemoveBatchConsumer(batchConsumer)
	return c.AddBatchConsumer(destinationId, batchConsumer)
}

func (c *Cron) RemoveBatchConsumer(batchConsumer BatchConsumer) {
	jobs := c.scheduler.Jobs()
	for _, job := range jobs {
		if utils.ArrayContains(job.Tags(), batchConsumer.TopicId()) {
			err := c.scheduler.RemoveJob(job.ID())
			if err != nil {
				c.Errorf("Error removing job for[%s] id: %s: %v", batchConsumer.TopicId(), job.ID(), err)
			}
		}
	}
}

// Close scheduler
func (c *Cron) Close() {
	stopped := make(chan struct{})
	go func() {
		_ = c.scheduler.Shutdown()
		close(stopped)
	}()
	select {
	case <-stopped:
		c.Infof("Cron scheduler stopped")
	case <-time.After(time.Duration(c.config.ShutdownTimeoutSec) * time.Second):
		c.Warnf("Shutdown timeout [%ds] expired. Scheduler will be stopped forcibly. Active batches may be interrupted abruptly", c.config.ShutdownTimeoutSec)
	}
}
