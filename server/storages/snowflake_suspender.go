package storages

import (
	"database/sql"
	"fmt"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/safego"
	sf "github.com/snowflakedb/gosnowflake"
	"strings"
	"sync"
	"time"
)

const (
	alterQuery = `ALTER WAREHOUSE %s SUSPEND`
	showQuery = `SHOW WAREHOUSES LIKE '%s'`

	alreadySuspendedMsg = `Invalid state. Warehouse '%s' cannot be suspended.`
)

var (
	globalMutex = sync.Mutex{}
	suspenders    = make(map[string]*SnowflakeSuspender)
	usageCounters = make(map[string]int)
)

type SnowflakeSuspender struct {
	sync.Mutex
	key                      string
	warehouse                string
	lastRequestTime          time.Time
	lastRequestTimeInStorage time.Time
	suspended                bool
	runningTasksCount        uint64
	keepAwakeDuration        time.Duration
	dataSource               *sql.DB
	monitorKeeper            MonitorKeeper
	ticker                   *time.Ticker
	stopped                  chan bool
}

func AcquireSnowflakeSuspender(config *adapters.SnowflakeConfig, keepAwakeDuration time.Duration, monitorKeeper MonitorKeeper) (*SnowflakeSuspender, error) {
	globalMutex.Lock()
	defer globalMutex.Unlock()
	key := "snowflake_" + config.Account + "_" + config.Warehouse
	suspender, ok := suspenders[key]
	if !ok {
		cfg := &sf.Config{
			Account:  config.Account,
			User:     config.Username,
			Password: config.Password,
			Port:     config.Port,
			//Schema:    config.Schema,
			//Database:  config.Db,
			Warehouse: config.Warehouse,
			Params:    config.Parameters,
		}
		connectionString, err := sf.DSN(cfg)
		if err != nil {
			return nil, err
		}

		dataSource, err := sql.Open("snowflake", connectionString)
		if err != nil {
			return nil, err
		}
		suspender = &SnowflakeSuspender{key: key, warehouse: config.Warehouse,
			lastRequestTime:   time.Now(),
			keepAwakeDuration: keepAwakeDuration,
			dataSource:        dataSource,
			monitorKeeper:     monitorKeeper,
			stopped: 		   make(chan bool),
		}
		suspender.start()
		suspenders[key] = suspender
		usageCounters[key]++
	}
	return suspender, nil
}

func ReleaseSnowflakeSuspender(suspender *SnowflakeSuspender) {
	globalMutex.Lock()
	defer globalMutex.Unlock()
	var usg = usageCounters[suspender.key]
	switch {
	case usg == 1:
		delete(suspenders, suspender.key)
		suspender.stop()
		usageCounters[suspender.key] = 0
	case usg > 1:
		usageCounters[suspender.key]--
	default:
		logging.Errorf("Trying to release orphaned SnowflakeSuspender: %v", suspender.key)
	}
}

func (awk *SnowflakeSuspender) start() {
	logging.Infof("Starting SnowflakeSuspender %s", awk.key)
	awk.ticker = time.NewTicker(time.Second)
	safego.RunWithRestart(func() {
		for {
			select {
			case <-awk.ticker.C:
				awk.sync()
			case <-awk.stopped:
				awk.ticker.Stop()
				return
			}
		}
	})
}

func (awk *SnowflakeSuspender) stop() {
	logging.Infof("Stopping SnowflakeSuspender %s", awk.key)
	close(awk.stopped)
	err := awk.dataSource.Close()
	if err != nil {
		logging.Errorf("failed to close SnowflakeSuspender's datasource: %v", err)
	}
}

func (awk *SnowflakeSuspender) sync() {
	awk.Lock()
	defer awk.Unlock()
	logging.Debugf("Sync %v", awk)

	if awk.lastRequestTime.After(awk.lastRequestTimeInStorage) {

		//since we run every second, and we don't require to the second precision
		//it is not critical if we overwrite more fresh value from other instance
		err := awk.monitorKeeper.UpdateLastRunTime(awk.key, awk.lastRequestTime)
		if err != nil {
			logging.Errorf("failed to update last sql execution time for: %v err: %v", awk.key, err)
		}
		awk.lastRequestTimeInStorage = awk.lastRequestTime
	} else if !awk.suspended && awk.runningTasksCount == 0 &&
		time.Since(awk.lastRequestTime) > awk.keepAwakeDuration {
		//check maybe other instances run sql and refreshed 'last run time'
		tm, err := awk.monitorKeeper.GetLastRunTime(awk.key)
		if err != nil {
			logging.Errorf("failed to get last sql execution time for: %v err: %v", awk.key, err)
		}
		if tm.Sub(awk.lastRequestTime).Seconds() >= 1 {
			logging.Debugf("Sync %v fresh in storage: %v", awk.key, tm)
			awk.lastRequestTimeInStorage = tm
			awk.lastRequestTime = tm
		} else {
			logging.Infof("%v Suspending warehouse", awk.key)
			_, err := awk.dataSource.Exec(fmt.Sprintf(alterQuery, awk.warehouse))
			if err != nil && !strings.HasSuffix(err.Error(), fmt.Sprintf(alreadySuspendedMsg, awk.warehouse)) {
				logging.Errorf("error while suspending warehouse for: %v err: %v", awk.key, err)
			} else {
				awk.suspended = true
			}
		}
	}
}


func (awk *SnowflakeSuspender) RegisterTaskStart() {
	if awk == nil {
		return
	}
	awk.Touch()
	awk.Lock()
	defer awk.Unlock()
	awk.runningTasksCount++
}

func (awk *SnowflakeSuspender) RegisterTaskEnd() {
	if awk == nil {
		return
	}
	awk.Touch()
	awk.Lock()
	defer awk.Unlock()
	awk.runningTasksCount--
}

//Touch informs that Snowflake adapter is in use and suspend need to be postponed
//Snowflake suspender relies on Autoresume feature - so we suggest that Touch resumes warehouse
func (awk *SnowflakeSuspender) Touch() {
	if awk == nil {
		return
	}
	//check if suspended
	awk.Lock()
	defer awk.Unlock()
	awk.lastRequestTime = time.Now()
	awk.suspended = false
}

func (awk *SnowflakeSuspender) String() string {
	return fmt.Sprintf("SnowflakeSuspender: %s last: %v storage: %v suspended: %v tasks: %v", awk.key, awk.lastRequestTime.Format("2006-01-02 15:04:05 MST"), awk.lastRequestTimeInStorage.Format("2006-01-02 15:04:05 MST"), awk.suspended, awk.runningTasksCount)
}
